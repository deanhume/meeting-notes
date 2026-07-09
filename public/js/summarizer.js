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

// Off-topic small talk — weather, sport, holidays, food, family chit-chat. These
// sentences are pushed down so the meeting's substance isn't buried by pleasantries.
const SMALLTALK_CUE = /\b(?:weather|surf(?:ing|ed)?|swim(?:ming)?|swam|crab|crabs|beach|ocean|lake|sea|sunny|sunshine|summer|winter|degrees|holiday|vacation|global war\w*|weekend|football|coffee|lunch|dinner|crystal clear|open[\s-]?water)\b/i;

// Personal-commitment cues used to detect action items — a first-person owner
// ("I'll", "let me", "I need to") paired with a task verb, or an explicit
// "action item" / "take a note" phrase. Kept separate from ranking so genuine
// follow-ups surface even when they aren't the most central sentences.
const COMMIT_CUE = /\b(?:i'?ll|we'?ll|i will|we will|i'?m going to|i am going to|i'?m gonna|i need to|we need to|let me|i can|i'?ve got to|assign(?:ed)?|responsible for)\b/i;
const TASK_VERB = /\b(?:check|double[\s-]?check|find out|chase|take (?:a |an |your |some )?(?:note|notes|action)|look into|pull|send|follow[\s-]?up|re-?read|investigate|confirm|verify|report back|get (?:some )?(?:data|numbers|extra)|dig into|take care of)\b/i;
const EXPLICIT_ACTION = /\b(?:action item|to-?do|take (?:a |an )?action|follow[\s-]?up|next step)\b/i;

// Words a truncated ASR fragment tends to trail off on ("...we're not going with
// any video, I can't.", "...who to go."). Sentences ending here are down-weighted.
const DANGLING_END = new Set(('and but so or to with the a an of in on for that i we you he she they '
  + 'is are was were will would can cant cannot could should cnt now then when if because '
  + 'dont wont couldnt shouldnt wouldnt havent isnt whos').split(/\s+/));

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

// Discourse markers / fillers that add nothing at the START of a bullet
// ("So…", "And…", "Okay, well…", "I mean…"). Stripped so bullets open on substance.
const LEADING_DISCOURSE = /^(?:so|and|but|now|okay|ok|well|yeah|yes|right|like|i mean|you know|basically|actually|anyway|um+|uh+|oh|see|alright|right then)[\s,]+/i;

// Self-correction / hedging interjections dropped from the middle of a sentence.
const SELF_CORRECTION = /\b(?:sorry|excuse me|i mean|or rather|you know)\b\s*,?/gi;

// Remove a leading run of discourse markers (handles stacked ones like
// "So basically, well,"). Falls back to the original if everything is stripped.
function stripLeadingDiscourse(s) {
  let out = s.trim();
  let prev;
  do {
    prev = out;
    out = out.replace(LEADING_DISCOURSE, '').trim();
  } while (out !== prev && out);
  return out || s.trim();
}

// Collapse spoken disfluency the transcript leaks into a chosen sentence:
// immediately repeated words ("high, high, high" -> "high") and self-corrections
// ("…optimising your habit, excuse me, your app…" -> "…optimising your habit your app…"),
// then tidy the leftover spacing/commas.
function collapseDisfluency(s) {
  let out = s;
  let prev;
  do {
    prev = out;
    out = out.replace(/\b([\w']+)(?:[\s,]+\1\b)+/gi, '$1');
  } while (out !== prev);
  out = out.replace(SELF_CORRECTION, ' ');
  return out
    .replace(/\s+,/g, ',')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/\s+([.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,]+/, '')
    .trim();
}

// Clean a chosen sentence for display/ranking: collapse disfluency, then strip
// any leading discourse marker left at the front.
function cleanForSummary(s) {
  return stripLeadingDiscourse(collapseDisfluency(s));
}

// Split a long run-on sentence into tighter clause units at strong internal
// discourse boundaries (", so", ", but", ", now"…), so the ranker scores compact
// ideas instead of one sprawling sentence. Only applied to long sentences, and
// only kept when every resulting part is itself substantial — otherwise the whole
// sentence is preserved (we never emit tiny fragments).
function splitRunOns(sentence) {
  if (summaryWords(sentence).length <= 25) return [sentence];
  const parts = sentence
    .split(/[,;]\s+(?=(?:so|but|now|because|which is why|and then|so then)\b)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && parts.every((p) => summaryWords(p).length >= 6)) {
    return parts;
  }
  return [sentence];
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
  // Bury off-topic small talk (weather, sport, holidays) below meeting substance.
  if (SMALLTALK_CUE.test(sentence)) boost *= 0.25;
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

// A sentence that is *only* off-topic small talk — it matches a small-talk cue and
// carries no meeting signal (no action, decision or number). Dropped from
// candidacy so a cluster of chit-chat can't win on TextRank centrality alone.
function isSmallTalkOnly(sentence) {
  return (
    SMALLTALK_CUE.test(sentence) &&
    !isActionItem(sentence) &&
    !DECISION_CUE.test(sentence) &&
    !/\d/.test(sentence)
  );
}

// True when a sentence reads as a personal action item / commitment: an explicit
// "action item" / "take a note" phrase, or a first-person owner cue paired with a
// concrete task verb ("I'll double check", "let me find out", "I can chase that").
function isActionItem(sentence) {
  if (EXPLICIT_ACTION.test(sentence)) return true;
  if (/\btake (?:a |an |your |some )?(?:note|notes|action)\b/i.test(sentence)) return true;
  return COMMIT_CUE.test(sentence) && TASK_VERB.test(sentence);
}

// Multiplicative penalty for a sentence that trails off mid-thought — a common
// artefact of speech-to-text splitting one utterance across lines.
function danglingPenalty(sentence) {
  const words = summaryWords(sentence);
  if (words.length === 0) return 1;
  const last = words[words.length - 1].replace(/'/g, '');
  return DANGLING_END.has(last) ? 0.45 : 1;
}

// Greedily pick up to `count` items from `pool` by Maximal Marginal Relevance:
// prefer high score, but discount anything too similar to what's already chosen so
// bullets don't repeat. Returns the picks in selection (score) order.
function selectByMMR(pool, count, lambda) {
  if (pool.length === 0) return [];
  const candidates = pool.slice().sort((a, b) => b.score - a.score);
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
  return selected;
}

/**
 * Summarise a meeting transcript into a Markdown bullet list. When the transcript
 * contains distinct discussion points *and* follow-up commitments, the output is
 * split into a "Key points" section and an "Action items" section (both rendered
 * as bullets so every line stays a valid Markdown list item); otherwise a single
 * flat bullet list is returned.
 * @param {string} transcript - the (cleaned) transcript text
 * @returns {string} newline-joined "- bullet" lines, or '' when there's nothing
 */
function summarizeToBullets(transcript) {
  const clean = (transcript || '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return '';

  // Split into sentences, break long run-ons into tighter clause units, then
  // clean spoken disfluency / leading discourse markers from each candidate.
  const all = splitSentences(clean)
    .flatMap(splitRunOns)
    .map(cleanForSummary)
    .filter((s) => summaryWords(s).length >= 3);

  // Nothing rankable — bullet the whole thing as-is.
  if (all.length <= 1) {
    return '- ' + tidySentence(cleanForSummary(clean));
  }

  // Candidate gate: keep sentences with real substance (>=5 words and >=3 content
  // words), or anything carrying an action/decision signal. This drops the short
  // backchannel fragments ("Yeah.", "Exactly right.") that speech-to-text leaks.
  const substantive = all.filter((s) => {
    const w = summaryWords(s).length;
    const c = contentWords(s).length;
    const hasSignal = isActionItem(s) || DECISION_CUE.test(s);
    return (w >= 5 && c >= 3) || (hasSignal && w >= 4);
  });

  // Drop pure navigation / small-talk chatter, but never at the cost of emitting
  // nothing.
  const isChatter = (s) => isNavigationOnly(s) || isSmallTalkOnly(s);
  let sentences = substantive.filter((s) => !isChatter(s));
  if (sentences.length < Math.min(3, all.length)) {
    sentences = all.filter((s) => !isChatter(s));
  }
  if (sentences.length === 0) sentences = all;

  const sets = sentences.map((s) => new Set(contentWords(s)));
  const ranks = textRankScores(sets);

  // Final salience: centrality × meeting-signal boost × truncation penalty, with a
  // light positional nudge for the opening (context) and closing (wrap-up).
  const last = sentences.length - 1;
  const scored = sentences.map((s, i) => {
    let score = ranks[i] * signalBoost(s) * danglingPenalty(s);
    if (i === 0) score *= 1.15;
    if (i === last) score *= 1.2;
    return { s, i, score, set: sets[i], action: isActionItem(s) };
  });

  // Route commitments to their own section; everything else is a key point.
  const keyPool = scored.filter((o) => !o.action);
  const actionPool = scored.filter((o) => o.action);

  const keyCount = Math.min(7, Math.max(3, Math.round(keyPool.length * 0.3)));
  const actionCount = Math.min(6, actionPool.length);

  const keys = selectByMMR(keyPool, keyCount, 0.7).sort((a, b) => a.i - b.i);
  const actions = selectByMMR(actionPool, actionCount, 0.6).sort((a, b) => a.i - b.i);

  const keyLines = keys.map((o) => '- ' + tidySentence(o.s));
  const actionLines = actions.map((o) => '- ' + tidySentence(o.s));

  // Only add section headers when both sections carry weight; otherwise stay flat
  // so short transcripts read as a simple list. Headers are themselves bullets so
  // every emitted line remains a valid Markdown list item.
  if (keyLines.length && actionLines.length) {
    return ['- **Key points**', ...keyLines, '- **Action items**', ...actionLines].join('\n');
  }
  return (keyLines.length ? keyLines : actionLines).join('\n');
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
    stripLeadingDiscourse,
    collapseDisfluency,
    cleanForSummary,
    splitRunOns,
    isActionItem,
    summarizeToBullets,
  };
}
