/* ── Meeting transcript summariser ────────────────────────────
 * Fully on-device, deterministic, dependency-free extractive summariser.
 *
 * Preserve source segments, join contextual passages, extract conservative
 * meeting records, then rank discussion highlights within lexical topic groups.
 * Confirmed actions and decisions are retained; other passages compete for a
 * shared word budget instead of one quota per fragment/topic.
 *
 * This is shared by the browser (loaded as a global before app.js) and by the
 * Jest suite (required as a CommonJS module). It performs no DOM or I/O work.
 */

const summaryTranscriptTools = typeof module !== 'undefined' && module.exports
  ? require('./transcript-clean')
  : window.transcriptCleanup;

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

// Phrases that signal a decision / agreement. Matched case-insensitively.
const DECISION_CUE = /\b(?:decid\w*|agree\w*|go(?:ing)? with|conclu\w*|final\w*|resolv\w*|settl\w*|chose|choose|approv\w*|sign(?:ed)? off)\b/i;

// Presentation / meeting-navigation filler — sentences about *running* the
// meeting rather than its substance. These are down-weighted.
const NAVIGATION_CUE = /\b(?:next slide|previous slide|this slide|the slide|left[\s-]?hand side|right[\s-]?hand side|hand (?:it )?over|hand over|toss it (?:to|over)|walk you through|move (?:on )?to (?:the )?(?:next|previous|slide)|go back to (?:the )?previous|go ahead|introduce yourself|put a pin)\b/i;

// Personal-commitment cues used to detect action items — a first-person owner
// ("I'll", "let me", "I need to") paired with a task verb, or an explicit
// "action item" / "take a note" phrase. Kept separate from ranking so genuine
// follow-ups surface even when they aren't the most central sentences.
const TASK_VERB = /\b(?:check|double[\s-]?check|find out|chase|take (?:a |an |your |some )?(?:note|notes|action)|look into|pull|send|follow[\s-]?up|re-?read|investigate|confirm|verify|report back|get (?:some )?(?:data|numbers|extra)|dig into|take care of|own|review|prepare|write|update|finish|complete|share|book|contact|deliver|deploy|ship|publish|test|fix)\b/i;
const EXPLICIT_ACTION = /\b(?:action item|to-?do|take (?:a |an )?action|follow[\s-]?up|next step)\b/i;
const NAMED_COMMITMENT = /\b([A-Z][\p{L}'-]+(?: [A-Z][\p{L}'-]+){0,2}) (?:will|must|needs to|has to|owns?|is responsible for)\b/u;
const TENTATIVE_CUE = /\b(?:maybe|perhaps|might|could|should|suggest(?:ed)?|propos(?:e|ed)|proposal is|consider(?:ing)?|not yet (?:agreed|decided|approved))\b/i;
const CORRECTION_CUE = /^(?:correction\b|actually\b|instead\b|no[, ]|scratch that\b)|\b(?:instead|replace[sd]?|changed? (?:the|our)|no longer)\b/i;
const NEGATIVE_CUE = /\b(?:no|not|never|cannot|can't|won't|didn't|don't|isn't|cancel(?:led|ed)?|rejected)\b/i;
const DATE_VALUE = '(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\\s+(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?)?|tomorrow|today|EOD|next (?:week|month|Monday|Tuesday|Wednesday|Thursday|Friday)|end of (?:day|week|month)|\\d{4}-\\d{2}-\\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}(?:,? \\d{4})?|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))';
const DUE_CUE = new RegExp('\\b(?:by|before|due(?: on)?)\\s+(' + DATE_VALUE + ')\\b', 'i');
const MEETING_SIGNAL = /\b(?:risks?|block(?:ers?|ed|ing)?|issues?|problems?|bugs?|delays?|deadlines?|cutoff|depend(?:s|ent|ency|encies)?|loss rates?|capacity|not (?:test(?:ed)?|support(?:ed)?|ready)|holding pattern|concerns?|worried|budgets?|revenue|costs?|burnout|workload|priorit(?:y|ies)|prioriti[sz]e|ship(?:s|ped|ping)?|launch|releases?|deliver(?:y)?|contracts?|audits?|redundan(?:t|cy)|layoffs?|buyers?|acquisition|reorg(?:ani[sz]ation)?|pay(?:ments?)?)\b/gi;
const TASK_PHRASE = '(?:double[ -]?check|find out|look into|reach out|follow[ -]?up|report back|take care of|take (?:a |an |your |some )?(?:note|notes|action)|get (?:the |some |a )?(?:data|numbers|copy|build|report|approval|details|quote)|check|chase|pull|send|email|relay|investigate|confirm|verify|review|prepare|write|update|finish|complete|share|book|contact|deliver|deploy|ship|publish|test|fix|ask|buy|spend|own|move|delay)';
const DIRECT_COMMITMENT = new RegExp("\\b(?:I(?:'ll| will| need to|'m going to| am going to)|we(?:'ll| will| need to|'re going to| are going to)|let me)\\s+(?:(?:just|also|first|then|double)\\s+){0,2}" + TASK_PHRASE + '\\b', 'i');
const NAMED_TASK = new RegExp('\\b[A-Z][\\p{L}\'-]+(?: [A-Z][\\p{L}\'-]+){0,2}\\s+(?:will|must|needs to|has to|is responsible for)\\s+' + TASK_PHRASE + '\\b', 'u');
const OWNERSHIP_TASK = /\b(?:[A-Z][\p{L}'-]+|[Hh]e|[Ss]he|[Tt]hey)\s+owns?\s+(?:the\s+)?[\p{L}\d]/u;
const PROPOSED_TASK = new RegExp("\\b(?:(?:I|we|you|one of us|someone) (?:can|could|should)|(?:maybe|perhaps) (?:we |you )?(?:should |could )?|might (?:want to |be worth )?|suggest(?:ed)? (?:that )?(?:we |you )?)\\b[^.!?]{0,55}\\b" + TASK_PHRASE + '\\b', 'i');
const OPEN_QUESTION = /^(?:who (?:owns?|will|is responsible)|when (?:will|can|is|do)|what (?:is blocking|are the (?:next steps|risks)|needs to)|how (?:much|many|will we)|is there (?:a|any) (?:blocker|risk|update)|are we (?:ready|blocked|waiting))\b/i;
const LOGISTICS_CUE = /\b(?:visit|meet(?:ing)?|calendar|invite|schedule|train|flight|travel)\b/i;
const CONVERSATION_ONLY = /^(?:do you know what|you know what I mean|what else|how was it|wasn't it|oh really|good to (?:chat|see)|see you|have a good(?: rest of your)? day|thank you(?: very much| for that)?|let me know if there's anything|I don't know|we'll see|so we'll see)[\s,.!?]*$/i;
const TOPIC_STOPWORDS = new Set([...SUMMARY_STOPWORDS, ...('also although because before back better biggest called come coming cool different down each even everything example final first future getting give good great happen heard here holding honest how however last least little looking looks made make making many more most much need needs new next nothing only other out own pattern people person place point put quite rather real same saying since something still such sure take team tell there time today together told tomorrow truth trying two understand unless until used using want wants way week what whatever when where whether which while why work working works years yesterday gonna wanna three four five six seven eight nine ten eleven twelve hundred thousand months weeks days hours minutes').split(/\s+/)]);

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

// A sentence that is *only* meeting navigation — it matches a navigation cue and
// carries no substantive signal (no decision, strong action, or number). These
// are dropped from candidacy entirely.
function isNavigationOnly(sentence) {
  return (
    NAVIGATION_CUE.test(sentence) &&
    !STRONG_ACTION_CUE.test(sentence) &&
    !DECISION_CUE.test(sentence) &&
    !/\d/.test(sentence)
  );
}

// True when a sentence reads as a personal action item / commitment: an explicit
// "action item" / "take a note" phrase, or a first-person owner cue paired with a
// concrete task verb ("I'll double check", "let me find out", "I can chase that").
function isActionItem(sentence) {
  if (/\?/.test(sentence) || TENTATIVE_CUE.test(sentence) || NEGATIVE_CUE.test(sentence)) return false;
  if (isUnfinished(sentence)) return false;
  if (EXPLICIT_ACTION.test(sentence) && TASK_VERB.test(sentence)) return true;
  return DIRECT_COMMITMENT.test(sentence) || NAMED_TASK.test(sentence) || OWNERSHIP_TASK.test(sentence);
}

function createTranscriptSegments(transcript) {
  if (transcript == null) return [];
  if (typeof transcript !== 'string') throw new TypeError('Transcript must be a string.');
  return splitSentences(transcript).map((text, index) => ({ id: `S${index + 1}`, text }));
}

function passageText(segments) {
  return segments.map((segment) => segment.text).join(' ');
}

function isUnfinished(text) {
  if (/\.{2,}\s*$/.test(text)) return true;
  if (/\b(?:at the same time|as well as|rather than|as opposed to|and then|and now|such as|which is (?:yeah|like|well))[.!]*$/i.test(text)) return true;
  const words = summaryWords(text);
  const last = (words.at(-1) || '').replace(/'/g, '');
  if (/^(?:now|then)$/.test(last) && words.length > 3) return false;
  if (/\b(?:about|with|for|on|to|from) (?:that|you|it)[.!]*$/i.test(text) && hasPredicate(text)) return false;
  if (/^(?:you|me|him|her|them|that|it)$/.test(last) && new RegExp(TASK_PHRASE, 'i').test(text)) return false;
  return DANGLING_END.has(last) || /^(?:their|our|your|my|his|her|some|any|these|those|its|thats|got|put|onto)$/.test(last);
}

function hasPredicate(text) {
  return /\b(?:is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|should|could|can|can't|cannot|don't|doesn't|didn't|it's|that's|they're|we're|I'm|I'll|we'll|you'll|I've|we've|they've|you've|there's|here's|need|needs|owns?|agreed|decided|approved|reported|grew|increased|lost|depends|seems?|feels?|looks?|cuts?|costs?|takes?|means?|makes?|uses?|ships?|shipped|wants?|requested|downloaded)\b/i.test(text);
}

function isCompletionPair(previous, next) {
  return !hasPredicate(previous) && /^(?:I|we|they|it)\b.{0,20}\b(?:it|that|this)\b.{0,25}\b(?:downloaded|finished|completed|sent|ready)\b/i.test(next);
}

function joinContinuation(previous, next) {
  if (/^[A-Z][\p{L}' -]+:/u.test(next) || /[?]\s*$/.test(previous)) return false;
  if (/^(?:No|Yes|Agreed|Correction|Actually)\b/i.test(next)) return false;
  const nextCore = next.replace(/^(?:(?:yeah|okay|well|you know|I mean|honestly|more so|so|and|but|like|right|also)[,\s]+)+/i, '');
  const independent = /^(?:I|We|You|They|He|She|It|The team|The project)\b/.test(nextCore);
  if (isCompletionPair(previous, next)) return true;
  if (!independent && summaryWords(next).length > 4 && !/\?$/.test(next) &&
      summaryWords(previous).at(-1) === summaryWords(next)[0]) return true;
  if (/\b(?:and|but|or|to|with|of|for|because|the|a|an|is|are|was|were|be|do|does|did|will|would|can|can't|cannot|should|if|when|at|into|got|put|their|our|your|some|any|than|like|without|in|on)[.!]*$/i.test(previous)) {
    return !independent || /\b(?:that|because|if|when)[.!]*$/i.test(previous);
  }
  return !independent && (
    /^[a-z]/.test(next) && !hasPredicate(next) ||
    /^(?:seems?|appears?|requires?|depends?)\b/.test(next) ||
    /^(?:because|which|whereas|rather than|according to|to|without|in|on|for|of|from)\b/i.test(next)
  );
}

function compactPassage(segments) {
  let text = '';
  let previous = '';
  for (const segment of segments) {
    let part = segment.text.trim();
    if (isBridgeFiller(part)) continue;
    if (!text) part = part.replace(/^(?:(?:so|and|okay|ok|well|yeah|right|you know|i mean|basically|um|uh)[,\s]+)+/i, '');
    if (text && joinContinuation(previous, part)) {
      text = text.replace(/[.]+\s*$/, '');
      if (/\bwhereas on the$/i.test(text) && /^The\b/.test(part)) text = text.replace(/\bon the$/i, '').trim();
      if (isCompletionPair(previous, part)) text += ':';
    }
    text += (text ? ' ' : '') + part;
    previous = segment.text;
  }
  return text
    .replace(/\b((?:[\w']+\s+){0,2}[\w']+)(?:[\s,.;:!?-]+\1\b)+/gi, (match, phrase) =>
      /\b(?:not|no|never|had)\b/i.test(phrase) ? match : phrase)
    .replace(/,\s*you know\s*,/gi, ',')
    .replace(/,\s*(?:right|you know what I mean)\?\s*$/i, '.')
    .replace(/[,\s]+(?:as in|you know|like|I mean)[.]*$/i, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBridgeFiller(text) {
  const words = summaryWords(text);
  return words.length <= 3 && !/\b(?:yes|no|agreed|not|never|will|won't|can|can't|cannot|must|should|could|would|if|but|before|after|without|unless|except|than)\b/i.test(text) &&
    words.every((word) => SUMMARY_STOPWORDS.has(word));
}

function displayIsExtractive(item) {
  const original = summaryWords(item.text);
  const display = summaryWords(item.displayText || item.text);
  let cursor = 0;
  for (const word of display) {
    while (cursor < original.length && original[cursor] !== word) cursor += 1;
    if (cursor === original.length) return false;
    cursor += 1;
  }
  const protectedWord = /^(?:no|not|never|cannot|can't|won't|don't|doesn't|didn't|isn't|wasn't|might|could|would|should|may|must|perhaps|maybe|possibly|probably|suspect|think|believe|seems?|sounds|sorry|instead|actually|rather|only|without|unless|except|before|after|if|than|but|whereas|although|because|until)$|[0-9]/i;
  return original.filter((word) => protectedWord.test(word)).every((word) => display.includes(word));
}

function trimEmptyLeadIn(text) {
  const emptyWords = new Set(["we've", 'want', 'something', 'some', 'work', 'more', 'then']);
  let result = text;
  for (const match of text.matchAll(/\b(?:and|so|then)\s+(?=it(?:'s| is)\b)/gi)) {
    const prefix = text.slice(0, match.index);
    const suffix = text.slice(match.index + match[0].length);
    if (summaryWords(prefix).length >= 6 && summaryWords(suffix).length >= 8 &&
        contentWords(prefix).every((word) => emptyWords.has(word)) &&
        displayIsExtractive({ text, displayText: suffix })) result = suffix;
  }
  return result;
}

function collectVisitArrangements(items, segments) {
  const intention = /\b(?:I(?:'m| am)|we(?:'re| are)) (?:coming|going) to (?:visit|meet)\b|\b(?:I|we)(?:'ll| will) (?:visit|meet)\b/i;
  const date = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
  for (let start = 0; start < segments.length; start += 1) {
    if (!intention.test(segments[start].text) || /[?]|\b(?:not|if|maybe)\b/i.test(segments[start].text)) continue;
    const chosen = new Map([[start, segments[start]]]);
    let hasDate = false;
    for (let index = start + 1; index < Math.min(segments.length, start + 60); index += 1) {
      const text = segments[index].text;
      if (intention.test(text) || /^(?:topic|agenda item):/i.test(text)) break;
      if (date.test(text) && summaryWords(text).length <= 9 && !isUnfinished(text) && !isActionItem(text)) {
        chosen.set(index, segments[index]);
        hasDate = true;
      }
      if (/\b(?:\d{1,2}:\d{2}|\d{3,4})\b.{0,12}\bsound\b/i.test(text)) {
        for (let nearby = Math.max(start, index - 1); nearby <= Math.min(segments.length - 1, index + 1); nearby += 1) chosen.set(nearby, segments[nearby]);
      }
      if (/\b(?:train|flight|drive|driving)\b/i.test(text) && /\b(?:going|will|I'll|taking|by)\b/i.test(text) && !/\?|\b(?:never|before|maybe|not)\b/i.test(text)) {
        chosen.set(index, segments[index]);
      }
      if (/\bwrong date\b/i.test(text)) {
        for (let nearby = index; nearby <= Math.min(segments.length - 1, index + 5); nearby += 1) chosen.set(nearby, segments[nearby]);
      }
    }
    if (!hasDate) continue;
    const evidence = [...chosen.entries()].sort(([a], [b]) => a - b).map(([, segment]) => segment);
    const ids = new Set(evidence.map((segment) => segment.id));
    const first = items.find((item) => item.evidence.some((entry) => entry.segmentId === segments[start].id));
    items.forEach((item) => {
      if (item.evidence.every((entry) => ids.has(entry.segmentId)) && item.kind !== 'action') item.coveredByLogistics = true;
      const position = Number(item.evidence[0].segmentId.slice(1)) - 1;
      if (item.kind === 'action' && position >= start && position <= Math.max(...chosen.keys()) && /\bsend (?:that|it)\b/i.test(item.text)) {
        item.topic = 'Visit arrangements';
        item.contextTopic = true;
      }
    });
    items.push({
      id: `L${start + 1}`, kind: 'discussion', status: 'unclear', logistics: true,
      text: passageText(evidence), displayText: compactPassage(evidence),
      index: first ? first.index : start, topic: '', explicitTopic: false,
      owner: null, due: null, supersedes: null,
      evidence: evidence.map((segment) => ({ segmentId: segment.id, quote: segment.text }))
    });
  }
}

function isContextReply(text, question) {
  return /^(?:yes|yeah|yep|no|nope|agreed|correct|absolutely|not yet|maybe|perhaps|ship it)\b/i.test(text) ||
    /^\$?\d/.test(text) || new RegExp('^' + DATE_VALUE + '[.!]?$', 'i').test(text) ||
    (/^who\b/i.test(question) && /^[A-Z][\p{L}'-]+(?: [A-Z][\p{L}'-]+)?[.!]?$/u.test(text));
}

function createPassages(segments) {
  const passages = [];
  let topic = '';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const heading = segment.text.match(/^(?:topic|agenda item):\s*(.+)/i);
    if (heading) { topic = heading[1].replace(/[.!?]$/, ''); continue; }
    const previous = segments[i - 1]?.text || '';
    if (summaryTranscriptTools.isBackchannelLine(segment.text, previous) || CONVERSATION_ONLY.test(segment.text)) continue;
    const evidence = [segment];
    while (evidence.length < 5 && segments[i + 1]) {
      const next = segments[i + 1];
      const tail = evidence.at(-1).text;
      if (/^(?:topic|agenda item):/i.test(next.text) || summaryWords(passageText(evidence) + ' ' + next.text).length > 65) break;
      const reply = evidence.length === 1 &&
        (/\?$/.test(tail) && (isContextReply(next.text, tail) ||
          isActionItem(next.text) && contentWords(next.text).some((word) => contentWords(tail).includes(word))) ||
         TENTATIVE_CUE.test(tail) && /^(?:yes|yeah|no|nope|agreed|absolutely)[.!]?\s*$/i.test(next.text));
      if (evidence.length === 1 && /\?$/.test(tail) && isBridgeFiller(next.text) &&
          segments[i + 2] && isContextReply(segments[i + 2].text, tail)) {
        evidence.push(next, segments[i + 2]);
        i += 2;
        break;
      }
      if (!reply && !joinContinuation(tail, next.text)) break;
      evidence.push(next);
      i += 1;
    }
    passages.push({ text: passageText(evidence), displayText: compactPassage(evidence), evidence, topic });
  }
  return passages;
}

function explicitOwner(text) {
  const match = text.match(NAMED_COMMITMENT);
  if (match && !/^(?:I|We|You|They|He|She|It|The|This|That|Someone|Everyone)$/.test(match[1])) return match[1];
  const speaker = text.match(/^([A-Z][\p{L}'-]+(?: [A-Z][\p{L}'-]+){0,2}):\s*(?:I\b|I'll\b|let me\b)/u);
  return speaker ? speaker[1] : null;
}

function classifyPassage(text) {
  const question = /\?/.test(text);
  if (question) {
    const reply = text.slice(text.lastIndexOf('?') + 1).trim();
    if (reply && isActionItem(reply)) return { kind: 'action', status: 'confirmed' };
    return { kind: !reply && OPEN_QUESTION.test(text) ? 'question' : 'discussion', status: 'unclear' };
  }
  if (TENTATIVE_CUE.test(text) && /[.!]\s+Agreed[.!]?$/i.test(text)) return { kind: 'decision', status: 'confirmed' };
  if (/\b(?:no decision|(?:not|haven't|hasn't|have not|has not) (?:yet )?(?:agreed|decided|approved)|(?:did not|didn't|never) (?:agree|decide|approve))\b/i.test(text)) {
    return { kind: 'proposal', status: 'tentative' };
  }
  if (PROPOSED_TASK.test(text) && !isUnfinished(text)) return { kind: 'proposal', status: 'tentative' };
  if (isActionItem(text)) return { kind: 'action', status: 'confirmed' };
  if (summaryWords(text).length >= 4 && /\b(?:decided|agreed|approved|rejected|chose|signed off|decision is)\b/i.test(text) ||
      /^(?:ship it|go ahead with|do not ship|don't ship)\b/i.test(text)) {
    return { kind: 'decision', status: 'confirmed' };
  }
  return { kind: 'discussion', status: 'unclear' };
}

function sameFact(a, b) {
  if (a.kind !== b.kind || a.status !== b.status || a.owner !== b.owner || a.due !== b.due) return false;
  if (NEGATIVE_CUE.test(a.text) !== NEGATIVE_CUE.test(b.text)) return false;
  const dates = new RegExp(DATE_VALUE + '|\\d+(?:[.,]\\d+)*', 'gi');
  if (JSON.stringify(a.text.match(dates)) !== JSON.stringify(b.text.match(dates))) return false;
  const normalise = (s) => s.toLowerCase().replace(/\b(?:need to|must|have to)\b/g, 'need to').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  return normalise(a.text) === normalise(b.text);
}

function passageScore(item) {
  const text = item.displayText;
  const words = summaryWords(text);
  if (!words.length || CONVERSATION_ONLY.test(text)) return 0;
  const signals = [...new Set((text.match(MEETING_SIGNAL) || []).map((signal) => signal.toLowerCase()))];
  let score = 1 + Math.min(4, signals.length) * 2;
  if (signals.length && /\b(?:than|instead of|rather than)\b/i.test(text)) score += 2;
  if (item.kind === 'action' || item.kind === 'decision') score += 6;
  if (item.kind === 'proposal' || item.kind === 'question') score += 2;
  if (item.kind === 'proposal' && /\b(?:copy|build|report|thread|contact|reach out|send|buy|spend)\b/i.test(text)) score += 3;
  if (DUE_CUE.test(text)) score += 2;
  if (/\b(?:already|have|has)\b.{0,35}\b(?:downloaded|completed|finished|sent|shipped)\b/i.test(text)) score += 3;
  if (/\b(?:copy|build|report|document|contract|checklist)\b/i.test(text) && /\b(?:downloaded|completed|finished|sent|available|ready)\b/i.test(text)) score += 3;
  if (/\b(?:physical copy|archive|future[ -]proof|legacy)\b/i.test(text)) score += 3;
  if (/\b(?:we(?:'re| are)|I(?:'m| am)|[\p{L}]+ and I are)\b.{0,25}\b(?:building|developing|launching|working on)\b/iu.test(text)) score += 3;
  if (/\b(?:the (?:plan|goal|idea) is|they(?:'re| are) trying to|we(?:'re| are) trying to)\b/i.test(text)) score += 3;
  if (/\b(?:it(?:'s| is)|this (?:is|tool)|the (?:project|tool|website|app|service) is)\b.{0,35}\b(?:for|allows?|helps?|lets?|enables?)\b/i.test(text)) score += 3;
  if (/\b(?:lost|losing|cut|reduced)\b.{0,20}\b(?:\d+|one|two|three|half|thirds?)\b|\b(?:half|thirds?) of my work\b/i.test(text)) score += 3;
  if (/\b(?:can't|cannot|need to|have to|must)\b.{0,50}\b(?:studios|unions?|opt-out|approval|addresses|permission)\b/i.test(text)) score += 3;
  if (/\$\d/.test(text) && item.kind === 'proposal') score += 3;
  if (/\b(?:prefer|partner(?:ing)? with|makes more sense)\b/i.test(text)) score += 4;
  if (/\b(?:don't|doesn't|not|can't|cannot)\b.{0,30}\b(?:support|test|work|capacity|fix)\b/i.test(text)) score += 3;
  if (/\b(?:APIs?|GPUs?|graphics cards|data cent(?:er|re)s|streaming|security|migration|vendor|contract|customer)\b/i.test(text)) score += 2;
  if (/\b(?:reach out|contact|find out|check in|look into)\b/i.test(text)) score += 3;
  if (LOGISTICS_CUE.test(text) && (new RegExp(DATE_VALUE, 'i').test(text) || /\b(?:coming|going|will|'ll|wrong date|corrected)\b/i.test(text))) score += 3;
  if (CORRECTION_CUE.test(text) && /\d|\b(?:monday|tuesday|wednesday|thursday|friday)\b/i.test(text)) score += 3;
  if (/\?\s+(?:no|yes|\$?\d)/i.test(text)) score += 3;
  if (!hasPredicate(text) && item.kind !== 'question' && item.kind !== 'decision') score *= 0.35;
  if (words.length < 5 && !signals.length && !['action', 'decision', 'question'].includes(item.kind)) score *= 0.25;
  if (!signals.length && !['action', 'decision'].includes(item.kind) &&
      /\b(?:don't|doesn't|not|can't|cannot)\b.{0,20}\b(?:want|work|help)\b/i.test(text) &&
      contentWords(text).length < 6) score *= 0.5;
  if (isUnfinished(text)) score *= 0.12;
  if (/^(?:if|what if|I wonder)\b/i.test(text)) score *= 0.5;
  if (/^I (?:think|wonder) (?:how|what|whether|why)\b/i.test(text)) score *= 0.5;
  if (/\?$/.test(text) && item.kind !== 'question') score *= 0.35;
  if (words.length > 60) score *= 0.6;
  if (item.hypothetical) score *= 0.15;
  if (/\b(?:another thing|might be aware|may be aware|being contacted|getting questions|general update|give you (?:a|some) updates)\b/i.test(text)) score *= 0.4;
  return score;
}

function topicTokens(text) {
  return text.match(/[\p{L}\p{N}]+(?:['-][\p{L}]+)*/gu) || [];
}

function informativeToken(word) {
  return !word.includes("'") && !TOPIC_STOPWORDS.has(word.toLowerCase()) && (word.length > 2 || /^[A-Z]{2,}$/.test(word));
}

function findTopics(items) {
  const explicit = [...new Set(items.filter((item) => item.explicitTopic).map((item) => item.topic))];
  if (explicit.length) return explicit.map((label) => ({ label, explicit: true, matches: items.filter((item) => item.topic === label).map((item) => item.index) }));
  if (items.length < 25) return [];
  const phrases = new Map();
  items.forEach((item) => {
    const tokens = topicTokens(item.displayText);
    const seen = new Set();
    for (let size = 1; size <= 3; size += 1) {
      for (let start = 0; start <= tokens.length - size; start += 1) {
        const words = tokens.slice(start, start + size);
        if (!words.every(informativeToken) || words.every((word) => /^\d+$/.test(word))) continue;
        if (size === 1 && (start === 0 || !/^[A-Z][A-Za-z]{2,}$/.test(words[0]))) continue;
        const key = words.join(' ').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!phrases.has(key)) phrases.set(key, { label: words.join(' '), key, matches: [], scores: [], size });
        const phrase = phrases.get(key);
        phrase.matches.push(item.index);
        phrase.scores.push(item.score);
        if (words.some((word) => /^[A-Z]{2,}$/.test(word))) phrase.acronym = true;
      }
    }
  });
  let ranked = [...phrases.values()].filter((phrase) => phrase.matches.length >= (phrase.size === 1 ? 3 : 2))
    .map((phrase) => ({
      ...phrase,
      weight: phrase.scores.slice().sort((a, b) => b - a).slice(0, 3).reduce((sum, score) => sum + score, 0) *
        Math.log2(phrase.matches.length + 1) * (phrase.size === 3 ? 1.35 : 1) * (phrase.acronym ? 1.4 : 1)
    })).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  if (ranked.some((phrase) => phrase.size > 1 && phrase.weight >= ranked[0].weight * 0.3)) {
    ranked = ranked.filter((phrase) => phrase.size > 1);
  }
  const topics = [];
  for (const candidate of ranked) {
    const significant = candidate.weight >= ranked[0].weight * 0.3;
    const expansion = ranked.find((entry) => entry.size > candidate.size && entry.key.includes(candidate.key) && (entry.acronym || entry.weight >= candidate.weight * 0.4));
    const phrase = expansion ? { ...expansion, matches: [...new Set([...expansion.matches, ...candidate.matches])] } : candidate;
    const stems = (key) => new Set(key.split(' ').map((word) => word.length > 3 ? word.replace(/s$/, '') : word));
    const overlapping = topics.find((topic) => {
      const a = stems(topic.key);
      const b = stems(phrase.key);
      const shared = [...a].filter((word) => b.has(word)).length;
      return topic.key.includes(phrase.key) || phrase.key.includes(topic.key) ||
        shared === Math.min(a.size, b.size) || jaccard(new Set(topic.matches), new Set(phrase.matches)) > 0.5;
    });
    const related = overlapping || significant && topics.find((topic) => phrase.matches.filter((index) => topic.matches.some((other) => Math.abs(index - other) <= 8)).length / phrase.matches.length > 0.6);
    if (related) {
      related.matches = [...new Set([...related.matches, ...phrase.matches])];
      continue;
    }
    if (significant && topics.length < 4) topics.push(phrase);
  }
  return topics;
}

function addFollowupContext(items, segments) {
  const names = new Set();
  for (const segment of segments) {
    const words = segment.text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
    words.filter(informativeToken).forEach((word) => names.add(word.toLowerCase()));
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== 'proposal' || !/(?:\b(?:copy|archive|build)\b|\$\d)/i.test(item.text)) continue;
    const context = items.slice(Math.max(0, index - 4), index).reverse().find((other) =>
      other.kind === 'discussion' && !isUnfinished(other.displayText) &&
      summaryWords(other.displayText).length >= 5 && summaryWords(other.displayText).length <= 40 &&
      contentWords(other.text).some((word) => names.has(word)) &&
      /\b(?:copy|build|archive|thing)\b/i.test(other.text));
    if (!context) continue;
    item.text = `${context.text} ${item.text}`;
    item.displayText = `${context.displayText} ${item.displayText}`;
    item.evidence = [...context.evidence, ...item.evidence];
  }
}

function assignTopics(items, topics) {
  for (const item of items) {
    if (item.explicitTopic || item.logistics || item.contextTopic) continue;
    let best = null;
    let bestScore = 0;
    const text = item.displayText.toLowerCase();
    for (const topic of topics) {
      if (topic.explicit) continue;
      const exact = text.includes(topic.key);
      const shared = topic.key.split(' ').filter((word) => contentWords(text).includes(word)).length;
      const distance = Math.min(...topic.matches.map((index) => Math.abs(index - item.index)));
      const score = exact ? 5 + (distance <= 4 ? 1 : 0) : shared * 0.5 + (distance <= 8 ? (9 - distance) / 4 : 0);
      const contextual = topic.size !== 1 && distance <= (item.kind === 'action' || item.score >= 3 ? 8 : 3);
      if (score > bestScore && (exact || shared >= 2 || contextual)) { best = topic; bestScore = score; }
    }
    item.topic = best ? best.label : '';
    item.topicMatch = best ? (text.includes(best.key) ? 2 : 0.75) : 0;
  }
}

function chooseHighlights(items, topics, brief) {
  const active = items.filter((item) => item.status !== 'superseded' && !item.coveredByLogistics);
  const fixed = active.filter((item) => item.logistics || ['action', 'decision'].includes(item.kind));
  const budget = brief ? 220 : 500;
  let used = fixed.reduce((sum, item) => sum + summaryWords(item.displayText).length, 0);
  const selected = [];
  const candidates = active.filter((item) => !fixed.includes(item) && item.score >= 1.5 && !isUnfinished(item.displayText));
  const maxCount = brief ? 7 : 16;
  const add = (item) => {
    const count = summaryWords(item.displayText).length;
    if (selected.includes(item) || used + count > budget) return false;
    const similar = [...fixed, ...selected].some((other) => {
      if (NEGATIVE_CUE.test(item.text) !== NEGATIVE_CUE.test(other.text)) return false;
      const numbers = (s) => (s.match(/\d+(?:[.:]\d+)*|\b(?:monday|tuesday|wednesday|thursday|friday)\b/gi) || []).join('|').toLowerCase();
      return numbers(item.text) === numbers(other.text) &&
        jaccard(new Set(contentWords(item.displayText)), new Set(contentWords(other.displayText))) > 0.65;
    });
    if (similar) return false;
    selected.push(item);
    used += count;
    return true;
  };
  // Give important topics an opportunity, not every arbitrary block of sentences.
  for (const topic of topics) {
    const best = candidates.filter((item) => item.topic === topic.label)
      .sort((a, b) => b.score - a.score || a.index - b.index)[0];
    if (best && selected.length < maxCount) add(best);
  }
  const ranked = candidates.slice().sort((a, b) =>
    (b.score + Math.min(3, b.topicMatch || 0)) - (a.score + Math.min(3, a.topicMatch || 0)) || a.index - b.index);
  for (const item of ranked) {
    if (selected.length >= maxCount) break;
    add(item);
  }
  return selected.sort((a, b) => a.index - b.index).map((item) => item.id);
}

function buildMeetingSummary(transcript) {
  const segments = createTranscriptSegments(transcript);
  const items = [];
  createPassages(segments).forEach((passage) => {
    const { text } = passage;
    if (isNavigationOnly(text)) return;
    const position = Number(passage.evidence[0].id.slice(1)) - 1;
    if (/^Let me (?:just )?(?:check|show|open|click|share)\b/i.test(text) && !DUE_CUE.test(text) &&
        segments.slice(Math.max(0, position - 2), position).some((segment) =>
          /\b(?:can you see|show (?:you|this)|sharing my screen|next slide)\b/i.test(segment.text))) return;
    const displayText = trimEmptyLeadIn(passage.displayText);
    const example = /\b(?:let's say|for example|imagine (?:that|if)|hypothetically|suppose that)\b/i;
    const context = segments.slice(Math.max(0, position - 3), position + 1);
    const topicBoundary = context.findLastIndex((segment) => /^(?:topic|agenda item):/i.test(segment.text));
    const hypothetical = !EXPLICIT_ACTION.test(text) && context.slice(topicBoundary + 1).some((segment) => example.test(segment.text));
    const classification = hypothetical ? { kind: 'discussion', status: 'unclear' } : classifyPassage(displayText);
    const claim = text.slice(text.lastIndexOf('?') + 1).trim();
    const item = {
      id: `F${passage.evidence[0].id.slice(1)}`,
      ...classification,
      hypothetical,
      text,
      displayText,
      index: items.length,
      topic: passage.topic,
      explicitTopic: !!passage.topic,
      owner: classification.kind === 'action' ? explicitOwner(claim) : null,
      due: classification.kind === 'action' ? (claim.match(DUE_CUE)?.[1] || null) : null,
      evidence: passage.evidence.map((segment) => ({ segmentId: segment.id, quote: segment.text })),
      supersedes: null
    };
    const previous = items[items.length - 1];
    if (previous && !hypothetical && CORRECTION_CUE.test(text) &&
        Number(item.evidence[0].segmentId.slice(1)) === Number(previous.evidence.at(-1).segmentId.slice(1)) + 1) {
      const overlap = contentWords(text).filter((word) => contentWords(previous.text).includes(word));
      if ((previous.kind === 'decision' || previous.kind === 'action') &&
          (overlap.length >= 2 || (summaryWords(text).length <= 5 && /\binstead\b/i.test(text)))) {
        item.kind = previous.kind;
        item.status = TENTATIVE_CUE.test(text) ? 'tentative' : 'confirmed';
        if (item.status === 'tentative') item.kind = 'proposal';
        // Keep the whole exchange instead of inventing a rewritten final decision.
        item.text = `${previous.text} ${text}`;
        item.displayText = `${previous.displayText} ${passage.displayText}`;
        item.evidence = [...previous.evidence, ...item.evidence];
        item.owner = item.kind === 'action' ? explicitOwner(text) : null;
        item.due = item.kind === 'action' ? (text.match(DUE_CUE)?.[1] || null) : null;
        item.supersedes = previous.id;
        if (item.status === 'confirmed') previous.status = 'superseded';
      }
    }
    const duplicate = items.find((existing) => sameFact(existing, item));
    if (duplicate) {
      duplicate.evidence.push(...item.evidence);
    } else {
      items.push(item);
    }
  });

  items.forEach((item) => { item.score = passageScore(item); });
  const topics = findTopics(items.filter((item) => item.status !== 'superseded'));
  addFollowupContext(items, segments);
  collectVisitArrangements(items, segments);
  items.forEach((item) => { item.score = passageScore(item); });
  assignTopics(items, topics);
  return {
    version: 1, segments, items, topics: topics.map((topic) => topic.label),
    highlights: chooseHighlights(items, topics, false),
    briefHighlights: chooseHighlights(items, topics, true)
  };
}

function renderMeetingSummary(summary, { brief = false, includeEvidence = false } = {}) {
  if (!summary.items.length) return '';
  const selected = new Set(brief && summary.briefHighlights ? summary.briefHighlights : summary.highlights);
  const visible = summary.items.filter((item) => item.status !== 'superseded' &&
    !item.coveredByLogistics && (item.logistics || ['action', 'decision'].includes(item.kind) || selected.has(item.id) ||
      !summary.briefHighlights && item.kind !== 'discussion'));
  const sections = [
    ['discussion', 'Key points'], ['decision', 'Decisions'], ['action', 'Action items'],
    ['proposal', 'Proposals (not confirmed)'], ['question', 'Open questions'],
    ['logistics', 'Visit arrangements (quoted)']
  ];
  const output = [];
  const showHeadings = visible.length > 1 || includeEvidence;
  sections.forEach(([kind, heading]) => {
    let entries = visible.filter((item) => (item.logistics ? 'logistics' : item.kind) === kind);
    if (!entries.length) return;
    if (showHeadings) output.push(`- **${heading}**`);
    const groupTopics = kind === 'discussion' && entries.some((item) => item.topic);
    if (groupTopics) {
      const topicOrder = [...new Set(entries.map((item) => item.topic))];
      entries = topicOrder.flatMap((topic) => entries.filter((item) => item.topic === topic));
    }
    let previousTopic = '';
    entries.forEach((item) => {
      if (groupTopics && item.topic !== previousTopic) {
        output.push(`- **${item.topic || 'Other points'}**`);
        previousTopic = item.topic;
      }
      let line = '- ' + (!groupTopics && item.topic ? `**${item.topic}:** ` : '') + tidySentence(item.displayText || item.text);
      if (includeEvidence) {
        if (kind === 'action') line += ` Owner: ${item.owner || 'not specified'}. Due: ${item.due || 'not specified'}.`;
        line += ` [${item.evidence.map((entry) => entry.segmentId).join(', ')}]`;
        if (item.supersedes) line += ' (Correction exchange; review the quoted wording.)';
      }
      output.push(line);
    });
  });
  if (includeEvidence && visible.length) {
    output.push('- **Supporting transcript passages**');
    const ids = new Set(visible.flatMap((item) => item.evidence.map((entry) => entry.segmentId)));
    summary.segments.filter((segment) => ids.has(segment.id)).forEach((segment) => {
      output.push(`- [${segment.id}] ${segment.text}`);
    });
  }
  return output.join('\n');
}

function summarizeToBullets(transcript, options) {
  return renderMeetingSummary(buildMeetingSummary(transcript), options);
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
    displayIsExtractive,
    createTranscriptSegments,
    buildMeetingSummary,
    renderMeetingSummary,
    summarizeToBullets,
  };
}

if (typeof window !== 'undefined') {
  window.meetingSummarizer = { createTranscriptSegments, buildMeetingSummary, renderMeetingSummary, summarizeToBullets };
}
