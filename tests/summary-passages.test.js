const assert = require('node:assert/strict');
const test = typeof globalThis.test === 'function' ? globalThis.test : require('node:test');
const {
  buildMeetingSummary, renderMeetingSummary, summarizeToBullets, displayIsExtractive, summaryWords
} = require('../public/js/summarizer');
const { validateEvidence } = require('../scripts/local-summary-model');

function checked(transcript) {
  const summary = buildMeetingSummary(transcript);
  assert.deepEqual(validateEvidence(summary), []);
  return summary;
}

test('joins a split subject and predicate without altering original evidence', () => {
  const summary = checked('I think the sync issues on that ticket.\nseem to be on the client rather than the service.');
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].displayText,
    'I think the sync issues on that ticket seem to be on the client rather than the service.');
  assert.deepEqual(summary.items[0].evidence.map((entry) => entry.segmentId), ['S1', 'S2']);
  assert.match(renderMeetingSummary(summary), /client rather than the service/);
});

test('rejoins a missing object without inserting a colon at the chunk seam', () => {
  const summary = checked("We don't want to put.\ncustom hardware in those offices.");
  assert.equal(summary.items[0].displayText, "We don't want to put custom hardware in those offices.");
});

test('does not attach a new speaker thought merely because the prior line is unfinished', () => {
  const summary = checked("Taylor is the person you need to...\nYeah, I mean, I've been reviewing the migration.");
  assert.equal(summary.items.length, 2);
  assert.equal(summary.items[0].text, 'Taylor is the person you need to...');
  assert.doesNotMatch(renderMeetingSummary(summary), /Taylor is the person you need to.*I've/);
});

test('keeps complete statements and provider names ending in now', () => {
  const text = summarizeToBullets('The deployment risks are resolved now.\nIt makes more sense to partner with Render Now.');
  assert.match(text, /risks are resolved now/);
  assert.match(text, /partner with Render Now/);
});

test('associates an artifact with its completed download, not a future action', () => {
  const summary = checked('Thank you for that.\nThe Orion 4 build.\nI have it downloaded.');
  assert.equal(summary.items[0].displayText, 'The Orion 4 build: I have it downloaded.');
  assert.equal(summary.items[0].kind, 'discussion');
  assert.match(renderMeetingSummary(summary), /Orion 4 build: I have it downloaded/);
});

test('preserves context for suggested purchases without inventing an owner', () => {
  const summary = checked("I can't help with the Orion 4 build.\nOne of us could buy a physical copy.");
  const proposal = summary.items.find((item) => item.kind === 'proposal');
  assert.equal(proposal.status, 'tentative');
  assert.equal(proposal.owner, null);
  assert.match(proposal.displayText, /Orion 4 build.*could buy a physical copy/);
  assert.deepEqual(proposal.evidence.map((entry) => entry.segmentId), ['S1', 'S2']);
});

test('does not turn rhetorical questions, predictions or possibilities into confirmed work', () => {
  const summary = checked("Isn't that strange?\nI think they'll close the office.\nI can check the report.\nWho owns the release?");
  assert.equal(summary.items.filter((item) => item.kind === 'action').length, 0);
  assert.equal(summary.items.filter((item) => item.kind === 'question').length, 1);
  assert.equal(summary.items.find((item) => /check the report/.test(item.text)).kind, 'proposal');
});

test('a repeated business keyword does not multiply a passage score', () => {
  const short = checked('The budget is tight.').items[0].score;
  const repeated = checked('The budget is tight because the budget and the budget are tight.').items[0].score;
  assert.equal(short, repeated);
});

function longDiscussion() {
  return Array.from({ length: 20 }, (_, index) => [
    `The SQL migration has ${index + 1} unresolved issues in region ${index + 1}.`,
    `We've discussed that because I'm still considering option ${index + 1}.`,
    `The SQL migrations are blocked in cluster ${index + 1}.`
  ].join('\n')).join('\n');
}

test('infers source phrases, merges plural variants and rejects conversational topic labels', () => {
  const summary = checked(longDiscussion());
  assert.equal(summary.topics.length, 1);
  assert.match(summary.topics[0], /SQL migration/);
  assert.doesNotMatch(summary.topics.join(' '), /because|I'm|we've|gonna/i);
  const output = renderMeetingSummary(summary);
  assert.equal(output.split(`**${summary.topics[0]}**`).length, 2);
  assert.ok(output.split('\n').every((line) => line.startsWith('- ')));
});

test('uses a shared word and item budget rather than a quota for every fragment', () => {
  const summary = checked(longDiscussion());
  assert.ok(summary.highlights.length <= 16);
  assert.ok(summary.briefHighlights.length <= 7);
  for (const [brief, budget] of [[false, 500], [true, 220]]) {
    const ids = brief ? summary.briefHighlights : summary.highlights;
    const selected = summary.items.filter((item) => ids.includes(item.id));
    assert.ok(selected.reduce((count, item) => count + summaryWords(item.displayText).length, 0) <= budget);
    assert.ok(summaryWords(renderMeetingSummary(summary, { brief })).length <= budget + 20);
  }
  assert.ok(renderMeetingSummary(summary, { brief: true }).length < renderMeetingSummary(summary).length);
});

test('mandatory commitments can exceed the budget without admitting more optional text', () => {
  const summary = checked(Array.from({ length: 40 }, (_, index) =>
    `Action item: review ticket ${index + 1} and send the report.`).join('\n') +
    '\nThe migration is blocked by the vendor.');
  assert.equal(summary.briefHighlights.length, 0);
  const output = renderMeetingSummary(summary, { brief: true });
  for (let index = 1; index <= 40; index += 1) assert.ok(output.includes(`review ticket ${index} `));
});

test('a tentative correction remains a proposal and does not cancel a confirmed commitment', () => {
  const summary = checked('Priya will send the report by Friday.\nMaybe Priya should send the report by Monday instead.');
  assert.equal(summary.items[0].status, 'confirmed');
  assert.equal(summary.items[1].kind, 'proposal');
  assert.equal(summary.items[1].status, 'tentative');
  assert.equal(summary.items[1].owner, null);
  assert.equal(summary.items[1].due, null);
});

test('bundles dated visit evidence but excludes transport jokes and unrelated deadlines', () => {
  const summary = checked([
    "I'm coming to visit next week.",
    'Tuesday the 9th.',
    'How does 1030 sound?',
    'Yes.',
    "I'm going to get the train this time.",
    'Maybe not on the train by themselves.',
    'Miki will send the report by Wednesday.'
  ].join('\n'));
  const visit = summary.items.find((item) => item.logistics);
  assert.ok(visit);
  assert.match(visit.displayText, /Tuesday the 9th/);
  assert.match(visit.displayText, /1030/);
  assert.match(visit.displayText, /get the train/);
  assert.doesNotMatch(visit.displayText, /by themselves|Miki/);
  assert.doesNotMatch(visit.displayText, /10:30|am|pm/);
  assert.equal(summary.items.find((item) => item.kind === 'action').owner, 'Miki');
});

test('keeps date correction exchanges instead of inventing a final calendar date', () => {
  const summary = checked("I'm coming to visit.\nThursday the 14th.\nI sent the wrong date.\nSent the 13th not the 14th.\nNo, the 14th.");
  const visit = summary.items.find((item) => item.logistics);
  assert.match(visit.displayText, /13th not the 14th/);
  assert.match(visit.displayText, /No, the 14th/);
  assert.doesNotMatch(visit.displayText, /2026|September/);
});

test('negative and currency answers remain visible alongside their questions', () => {
  const summary = checked('Can we launch Friday?\nNo.\nHow much is the budget?\n$1200.');
  const output = renderMeetingSummary(summary);
  assert.match(output, /Can we launch Friday\? No\./);
  assert.match(output, /How much is the budget\? \$1200\./);
});

test('retains contrast words even when the entire source fragment resembles filler', () => {
  const summary = checked('Oh, exactly.\nYeah, but.\nWe cannot support the new format.');
  assert.ok(summary.items.every(displayIsExtractive));
});

test('display validation rejects unsupported words, changed numbers and lost qualifiers', () => {
  const text = 'I think it could cost $400 if we delay.';
  assert.equal(displayIsExtractive({ text, displayText: text }), true);
  for (const displayText of [
    'It could cost $400 if we delay.',
    'I think it costs $400 if we delay.',
    'I think it could cost $4000 if we delay.',
    'I think it could cost $400.'
  ]) assert.equal(displayIsExtractive({ text, displayText }), false);
  assert.equal(displayIsExtractive({
    text: 'It could support Delta and possibly Echo.',
    displayText: 'It could support Delta and Echo.'
  }), false);
});

test('returns deterministic output without mutating the stored source or item text', () => {
  const transcript = longDiscussion();
  const summary = checked(transcript);
  const before = JSON.stringify(summary);
  assert.equal(renderMeetingSummary(summary), summarizeToBullets(transcript));
  renderMeetingSummary(summary, { brief: true, includeEvidence: true });
  assert.equal(JSON.stringify(summary), before);
});

test('recognises definite group email plans and relaying information without naming the speaker', () => {
  const summary = checked("We're going to email Morgan about the pilot.\nI'll relay it to the design group.");
  assert.equal(summary.items.filter((item) => item.kind === 'action').length, 2);
  assert.ok(summary.items.every((item) => item.owner === null));
});

test('does not make a live demonstration check into a follow-up', () => {
  const summary = checked("Can you see my screen?\nLet me just check the preview.\nI'll check the results by Friday.");
  assert.equal(summary.items.filter((item) => item.kind === 'action').length, 1);
  assert.equal(summary.items.find((item) => item.kind === 'action').due, 'Friday');
});

test('explicit examples do not become real commitments or statements of availability', () => {
  const summary = checked("Let's say a department needs a reviewer.\nMorgan will send the report.\nI can help, I'm not at full capacity.\nAction item: review the pilot proposal.");
  assert.equal(summary.items[1].hypothetical, true);
  assert.equal(summary.items[1].kind, 'discussion');
  assert.equal(summary.items[2].hypothetical, true);
  assert.equal(summary.items[3].kind, 'action');
  assert.doesNotMatch(renderMeetingSummary(summary), /Morgan will send|not at full capacity/);
});

test('example context does not cross an explicit agenda boundary', () => {
  const summary = checked("For example, Morgan will send a report.\nTopic: Rollout\nMorgan will send the checklist by Friday.");
  assert.equal(summary.items[1].kind, 'action');
  assert.equal(summary.items[1].hypothetical, false);
});

test('discourse-prefixed independent thoughts do not get appended to the previous fragment', () => {
  const summary = checked("They work with partners and joined in.\nHonestly, more so, I'm worried about losing the contract.");
  assert.equal(summary.items.length, 2);
  assert.equal(summary.items[1].evidence[0].segmentId, 'S2');
});

test('trims only empty lead-in wording and retains conditional meaning and evidence', () => {
  const summary = checked("We've got to do some more work and it's not supported if we delay the release.");
  assert.equal(summary.items[0].displayText, "it's not supported if we delay the release.");
  assert.equal(summary.items[0].text, "We've got to do some more work and it's not supported if we delay the release.");
});
