/* ── Meeting transcript summariser ────────────────────────────
 * Fully on-device, deterministic, dependency-free extractive summariser.
 *
 * Pipeline:
 *   1. Split the transcript into sentences.
 *   2. Rank sentences by graph centrality (TextRank) so the bullets that
 *      survive are the ones most representative of the whole conversation,
 *      rather than just the ones packed with frequently-repeated words.
 *   3. Boost sentences that carry meeting signal — action items, decisions,
 *      and concrete who/when/how-much detail (names, numbers, dates).
 *   4. Select the final bullets with Maximal Marginal Relevance (MMR) so two
 *      near-identical sentences never both make the cut.
 *   5. Emit a single flat, chronological bullet list.
 *
 * This is shared by the browser (loaded as a global before app.js) and by the
 * Jest suite (required as a CommonJS module). It performs no DOM or I/O work.
 */

// Common words that carry little topical meaning. Excluded from term salience,
// similarity scoring, and signal detection.
const SUMMARY_STOPWORDS = new Set(('a an and the of to in on for with at by from up about into over after ' +
  'is are was were be been being am do does did doing have has had having will would shall should can could ' +
  'may might must this that these those it its it\'s i you he she we they me him her us them my your his our their ' +
  'so but or nor if then else than as too very just not no yes ok okay yeah um uh like really actually basically ' +
  'kind sort going get got go went said say says know think thing things stuff well right mean lot bit one').split(/\s+/));

// Phrases that signal an action item / commitment. Matched case-insensitively.
// Strong action-item cues — concrete commitments. Always boost.
const STRONG_ACTION_CUE = /\b(?:need(?:s)? to|have to|has to|action item|to-?do|follow[\s-]?up|next step|deadline|due|assign(?:ed|ing)?|responsible|owns?|take care of|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|eod|next week|end of (?:day|week)))\b/i;

// Weak future cues — a pronoun + "will"/"going to". These leak into presentation
// chatter ("I'm going to move to the next slide"), so they only count when the
// sentence also carries a concrete who/when (proper noun, number or date).
const WEAK_FUTURE_CUE = /\b(?:i'?ll|we'?ll|you'?ll|they'?ll|i will|we will|going to|gonna)\b/i;

// Phrases that signal a decision / agreement. Matched case-insensitively.
const DECISION_CUE = /\b(?:decid\w*|agree\w*|go(?:ing)? with|conclu\w*|final\w*|resolv\w*|settl\w*|chose|choose|approv\w*|sign(?:ed)? off)\b/i;

// Presentation / meeting-navigation filler — sentences about *running* the
// meeting rather than its substance. These are down-weighted.
const NAVIGATION_CUE = /\b(?:next slide|previous slide|this slide|the slide|left[\s-]?hand side|right[\s-]?hand side|hand (?:it )?over|hand over|toss it (?:to|over)|walk you through|move (?:on )?to (?:the )?(?:next|previous|slide)|go back to (?:the )?previous|go ahead|introduce yourself|put a pin)\b/i;

// Lowercase word tokens (used for salience, similarity and length checks).
function summaryWords(s) {
  return (s.toLowerCase().match(/[a-z0-9']+/g) || []);
}

// Topical content words: tokens that aren't stopwords and are >2 chars.
function contentWords(s) {
  return summaryWords(s).filter((w) => !SUMMARY_STOPWORDS.has(w) && w.length > 2);
}

// Capitalise, collapse whitespace, ensure terminal punctuation.
function tidySentence(s) {
  let out = s.trim().replace(/\s+/g, ' ');
  if (!out) return out;
  out = out.charAt(0).toUpperCase() + out.slice(1);
  if (!/[.!?]$/.test(out)) out += '.';
  return out;
}

// Split a transcript into trimmed sentences. Honours both terminal punctuation
// and the one-sentence-per-line shape that the Whisper cleanup already produces.
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Jaccard similarity of two content-word sets (0..1). Used for MMR de-duplication.
function jaccard(aSet, bSet) {
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  aSet.forEach((w) => { if (bSet.has(w)) inter += 1; });
  return inter / (aSet.size + bSet.size - inter);
}

// TextRank similarity between two sentences: shared content words normalised by
// the (log) length of each, the classic TextRank weighting. Robust to length.
function textRankSimilarity(aSet, bSet) {
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  aSet.forEach((w) => { if (bSet.has(w)) inter += 1; });
  if (inter === 0) return 0;
  const denom = Math.log(aSet.size + 1) + Math.log(bSet.size + 1);
  return denom === 0 ? 0 : inter / denom;
}

// Weighted PageRank over the sentence-similarity graph. Deterministic: fixed
// damping, fixed iteration count, array-ordered traversal.
function textRankScores(sets) {
  const n = sets.length;
  const scores = new Array(n).fill(1);
  if (n === 1) return scores;

  // Pre-compute the symmetric similarity matrix and per-node weight sums.
  const sim = Array.from({ length: n }, () => new Array(n).fill(0));
  const weightSum = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const w = textRankSimilarity(sets[i], sets[j]);
      sim[i][j] = w;
      sim[j][i] = w;
      weightSum[i] += w;
      weightSum[j] += w;
    }
  }

  const damping = 0.85;
  for (let iter = 0; iter < 40; iter += 1) {
    const next = new Array(n).fill(1 - damping);
    for (let i = 0; i < n; i += 1) {
      let acc = 0;
      for (let j = 0; j < n; j += 1) {
        if (i === j || sim[j][i] === 0 || weightSum[j] === 0) continue;
        acc += (sim[j][i] / weightSum[j]) * scores[j];
      }
      next[i] += damping * acc;
    }
    for (let i = 0; i < n; i += 1) scores[i] = next[i];
  }
  return scores;
}

// Multiplicative "meeting signal" boost for a sentence: action items and
// decisions matter most; concrete names/numbers/dates add a little; sentences
// that are just meeting navigation ("next slide", "hand it over") are penalised.
function signalBoost(sentence) {
  let boost = 1;
  // Numbers, times or dates (e.g. "$5k", "3pm", "Q3", "by the 5th").
  const hasNumber = /\d/.test(sentence);
  // A capitalised word that isn't the sentence's first token — a likely proper
  // noun (person, team, product) rather than just a sentence-initial capital.
  const hasProperNoun = /\s[A-Z][a-z]{2,}/.test(sentence);

  if (STRONG_ACTION_CUE.test(sentence)) boost *= 1.6;
  // Weak future commitments only count when grounded by a who/when.
  else if (WEAK_FUTURE_CUE.test(sentence) && (hasNumber || hasProperNoun)) boost *= 1.3;

  if (DECISION_CUE.test(sentence)) boost *= 1.5;
  if (hasNumber) boost *= 1.2;
  if (hasProperNoun) boost *= 1.15;

  // Push presentation/navigation chatter to the bottom.
  if (NAVIGATION_CUE.test(sentence)) boost *= 0.35;
  return boost;
}

// A sentence that is *only* meeting navigation — it matches a navigation cue and
// carries no substantive signal (no decision, strong action, or number). These
// are dropped from candidacy entirely, because TextRank's centrality otherwise
// rewards their repeated "slide / next / previous" vocabulary.
function isNavigationOnly(sentence) {
  return (
    NAVIGATION_CUE.test(sentence) &&
    !STRONG_ACTION_CUE.test(sentence) &&
    !DECISION_CUE.test(sentence) &&
    !/\d/.test(sentence)
  );
}

/**
 * Summarise a meeting transcript into a single flat Markdown bullet list.
 * @param {string} transcript - the (cleaned) transcript text
 * @returns {string} newline-joined "- bullet" lines, or '' when there's nothing
 */
function summarizeToBullets(transcript) {
  const clean = (transcript || '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return '';

  const all = splitSentences(clean).filter((s) => summaryWords(s).length >= 3);

  // Nothing rankable — bullet the whole thing as-is.
  if (all.length <= 1) {
    return '- ' + tidySentence(clean);
  }

  // Drop pure navigation chatter, but only while enough real content survives;
  // otherwise rank everything rather than emit nothing.
  const content = all.filter((s) => !isNavigationOnly(s));
  const sentences = content.length >= Math.min(3, all.length) ? content : all;

  const sets = sentences.map((s) => new Set(contentWords(s)));
  const ranks = textRankScores(sets);

  // Final salience: centrality × meeting-signal boost, with a light positional
  // nudge for the opening (context) and closing (wrap-up / decisions).
  const last = sentences.length - 1;
  const scored = sentences.map((s, i) => {
    let score = ranks[i] * signalBoost(s);
    if (i === 0) score *= 1.15;
    if (i === last) score *= 1.2;
    return { s, i, score, set: sets[i] };
  });

  // How many bullets: ~30% of sentences, clamped to a sensible 3..7.
  const count = Math.min(7, Math.max(3, Math.round(sentences.length * 0.3)));

  // Maximal Marginal Relevance: greedily pick the highest-scoring sentence that
  // isn't too similar to what's already chosen, so bullets don't repeat.
  const lambda = 0.7;
  const candidates = scored.slice().sort((a, b) => b.score - a.score);
  const maxScore = candidates[0].score || 1;
  const selected = [];
  while (selected.length < count && candidates.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let k = 0; k < candidates.length; k += 1) {
      const c = candidates[k];
      let maxSim = 0;
      for (let m = 0; m < selected.length; m += 1) {
        const sim = jaccard(c.set, selected[m].set);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * (c.score / maxScore) - (1 - lambda) * maxSim;
      if (mmr > bestVal) {
        bestVal = mmr;
        bestIdx = k;
      }
    }
    selected.push(candidates.splice(bestIdx, 1)[0]);
  }

  // Restore chronological order so the bullets read in meeting sequence.
  return selected
    .sort((a, b) => a.i - b.i)
    .map((o) => '- ' + tidySentence(o.s))
    .join('\n');
}

// Dual export: attach to the browser global scope, and expose for CommonJS
// (Jest) without breaking when `module` is undefined in the renderer.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUMMARY_STOPWORDS,
    summaryWords,
    contentWords,
    tidySentence,
    splitSentences,
    summarizeToBullets,
  };
}
