const assert = require('node:assert/strict');
const test = typeof globalThis.test === 'function' ? globalThis.test : require('node:test');
const {
  buildMeetingSummary, renderMeetingSummary, renderSummaryItem, summaryWords
} = require('../public/js/summarizer');
const { validateEvidence } = require('../scripts/local-summary-model');

function checked(transcript) {
  const summary = buildMeetingSummary(transcript);
  assert.deepEqual(validateEvidence(summary), []);
  return summary;
}

test('covers different facts instead of spending the budget on repeated project introductions', () => {
  const transcript = [
    'Topic: Telemetry migration',
    ...Array.from({ length: 12 }, (_, index) =>
      `The plan is to move the telemetry service to cluster ${index + 1} with an updated data pipeline.`),
    'The migration is our biggest risk to the release.',
    'We are waiting for the supplier to explain the elevated failure rate.',
    "We don't test or support those network adapters.",
    'The old applications are not future proof if they need new APIs.',
    "The hosting service doesn't have spare capacity.",
    'They want to keep the capacity for analytics.',
    'My concern is that the support team might become redundant after delivery.',
    'This kind of makes more sense to me to partner with Cedar Computing.',
    'Topic: Follow-ups',
    'The Orion 7 build.',
    'I have it downloaded.',
    'Mina will send the report by Friday.'
  ].join('\n');
  const summary = checked(transcript);
  const output = renderMeetingSummary(summary);
  for (const phrase of [
    'biggest risk', 'elevated failure rate', 'network adapters', 'future proof',
    'spare capacity', 'capacity for analytics', 'might become redundant',
    'partner with Cedar Computing', 'Orion 7 build: downloaded', 'Mina will send'
  ]) assert.ok(output.toLowerCase().includes(phrase.toLowerCase()), `Missing ${phrase}\n${output}`);
  assert.ok(output.split('\n').filter((line) => /updated data pipeline/.test(line)).length <= 2);
  const selected = summary.items.filter((item) => summary.highlights.includes(item.id) || item.kind === 'action');
  assert.ok(selected.reduce((count, item) => count + summaryWords(renderSummaryItem(item)).length, 0) <= 360);
});

test('a contact does not become the owner of a contextualised thread follow-up', () => {
  const summary = checked("Topic: Release\nAlex Chen is the contact.\nThe release thread has missing details.\nI'll just check in there.");
  const action = summary.items.find((item) => item.kind === 'action');
  assert.equal(action.owner, null);
  assert.equal(action.actionContext.value, 'thread');
  assert.match(renderSummaryItem(action), /^Check the thread\./);
  assert.match(renderMeetingSummary(summary, { includeEvidence: true }), /Owner: not specified/);
  assert.ok(action.evidence.some((entry) => /release thread/.test(entry.quote)));
});

test('different nearby artifacts are left ambiguous instead of guessing a referent', () => {
  const summary = checked("The report is ready.\nThe thread is blocked.\nI'll check it.");
  const action = summary.items.find((item) => item.kind === 'action');
  assert.equal(action.actionContext, undefined);
  assert.equal(action.contextUnclear, true);
  assert.match(renderSummaryItem(action), /Object not specified/);
});

test('two nearby threads are not treated as a unique referent merely because the noun matches', () => {
  const summary = checked("The Alpine thread is blocked.\nThe Harbor thread is ready.\nI'll check it.");
  assert.equal(summary.items.find((item) => item.kind === 'action').actionContext, undefined);
});

test('follow-up context does not cross an explicit topic change', () => {
  const summary = checked("Topic: Release\nThe release thread is blocked.\nTopic: Office\nI'll check it.");
  const action = summary.items.find((item) => item.kind === 'action');
  assert.equal(action.actionContext, undefined);
  assert.equal(action.topic, 'Office');
});

test('identical vague actions retain their separate objects instead of being deduplicated', () => {
  const summary = checked("Topic: Release\nThe thread is blocked.\nI'll check it.\nTopic: Operations\nThe report is ready.\nI'll check it.");
  const actions = summary.items.filter((item) => item.kind === 'action');
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map((item) => item.actionContext.value), ['thread', 'report']);
});

test('identical status wording under different agenda topics is not deduplicated', () => {
  const summary = checked('Topic: Release\nWe are blocked.\nTopic: Operations\nWe are blocked.');
  assert.equal(summary.items.length, 2);
  assert.deepEqual(summary.items.map((item) => item.topic), ['Release', 'Operations']);
});

test('clarification preserves a meaningful secondary task rather than silently dropping it', () => {
  const summary = checked("The performance report is ready.\nI'll check it and see how latency changed.");
  const action = summary.items.find((item) => item.kind === 'action');
  const output = renderSummaryItem(action);
  assert.match(output, /see how latency changed/);
  assert.match(output, /Context: report/);
});

test('a negated artifact is not used to resolve a vague action', () => {
  const summary = checked("There is no report.\nI'll check it.");
  assert.equal(summary.items.find((item) => item.kind === 'action').actionContext, undefined);
});

test('conditional commitments remain conditional proposals', () => {
  const summary = checked('If the supplier approves access, Mina will review the report by Friday.');
  assert.equal(summary.items[0].kind, 'proposal');
  assert.equal(summary.items[0].status, 'tentative');
  assert.match(renderMeetingSummary(summary), /If the supplier approves access/);
  assert.doesNotMatch(renderMeetingSummary(summary), /\*\*Action items\*\*/);
  assert.equal(checked('Mina will review the report if approval arrives.').items[0].kind, 'proposal');
});

test('an embedded if-question is not mistaken for a condition on an actual commitment', () => {
  for (const text of ["I'll check if the server is ready.", 'Mina will ask Jordan if the server is ready.']) {
    const summary = checked(text);
    assert.equal(summary.items[0].kind, 'action');
    assert.equal(summary.items[0].status, 'confirmed');
  }
});

test('an adjacent request for findings is not silently upgraded to a commitment', () => {
  const summary = checked("I'll find out and ask.\nIt'd be useful to know what you find out.");
  const action = summary.items.find((item) => item.kind === 'action');
  assert.equal(action.owner, null);
  assert.equal(action.sharingRequest, 'S2');
  assert.match(renderSummaryItem(action), /Requested: share findings \(not confirmed\)/);
  assert.ok(action.evidence.some((entry) => entry.segmentId === 'S2'));
});

test('sharing requests with conditions or dates are not simplified away', () => {
  const summary = checked("I'll find out and ask.\nLet me know what you find out if approval arrives by Friday.");
  assert.equal(summary.items.find((item) => item.kind === 'action').sharingRequest, undefined);
});

test('risk shortening does not remove the subject of an ordinary complete sentence', () => {
  const summary = checked('The migration is our biggest risk to the release.');
  assert.equal(renderSummaryItem(summary.items[0]), 'The migration is our biggest risk to the release.');
});

test('scope-sensitive comparisons keep the qualifier on the original claim', () => {
  for (const prefix of ['I think ', 'Perhaps ', 'According to Mina, ', 'Only ']) {
    const source = prefix + 'the current service uses standard adapters, whereas The plan is to use specialised adapters that we do not support.';
    const summary = checked(source);
    assert.ok(renderSummaryItem(summary.items[0]).startsWith(prefix));
    assert.match(renderSummaryItem(summary.items[0]), /current service uses standard adapters/);
  }
});

test('an independent comparison clause can be quoted without changing its negation', () => {
  const summary = checked('The existing service uses standard adapters, whereas The plan is to use specialised adapters that we do not support.');
  const item = summary.items[0];
  assert.equal(renderSummaryItem(item), 'The plan is to use specialised adapters that we do not support.');
  assert.match(item.text, /existing service uses standard adapters/);
  assert.match(item.evidence[0].quote, /whereas/);
});

test('qualifiers cannot be removed from one clause just because they also occur elsewhere', () => {
  const summary = checked('I think the current service is supported, whereas The plan is to use adapters that I think we cannot support.');
  assert.match(renderSummaryItem(summary.items[0]), /^I think the current service is supported/);
});

test('resource continuation preserves a suspected motive and the restrictive condition', () => {
  const summary = checked("I suspect they want to provide more Atlas.\ncapacity in regions where they can't reserve machines.\nin those offices.");
  assert.equal(summary.items.length, 1);
  const output = renderMeetingSummary(summary);
  assert.match(output, /I suspect/);
  assert.match(output, /Atlas capacity in regions where they can't reserve machines/);
  assert.equal(summary.items[0].facet, 'rationale');
});

test('unfinished numbered scope is visible but never repaired into a confirmed plan', () => {
  const summary = checked('They are trying to get Orion seven and possibly Orion six onto.');
  const output = renderMeetingSummary(summary);
  assert.match(output, /Orion seven and possibly Orion six/);
  assert.match(output, /unfinished plan/);
  assert.match(output, /incomplete source/);
  assert.doesNotMatch(output, /will ship|approved/);
});

test('conditional scope is not dropped when shortening an unfinished plan', () => {
  const summary = checked('If approval arrives, they are trying to get Orion seven onto.');
  assert.match(renderMeetingSummary(summary), /If approval arrives/);
});

test('purchase wording can be shortened without making the suggestion an assignment', () => {
  const summary = checked("I can't really help with the Orion seven thing.\nOne of us could buy a physical copy and then install it.");
  const proposal = summary.items.find((item) => item.kind === 'proposal');
  const output = renderSummaryItem(proposal);
  assert.match(output, /Context: Orion seven/);
  assert.match(output, /One of us could buy a physical copy/);
  assert.equal(proposal.owner, null);
  assert.equal(proposal.status, 'tentative');
  assert.match(proposal.text, /install it/);
});

test('purchase conditions and numbers survive compression', () => {
  const summary = checked("I can't help with the Orion seven thing.\nOne of us could buy a physical copy and then install it if approval arrives for 12 users.");
  const output = renderSummaryItem(summary.items.find((item) => item.kind === 'proposal'));
  assert.match(output, /if approval arrives for 12 users/);
});

test('a speculative archive is not presented as an available or confirmed artifact', () => {
  const summary = checked("Surely someone at Operations can find that build archive somewhere.\nIt might still be stored on a drive.\nI think you should spend $35 on a replacement.");
  const proposal = summary.items.find((item) => item.kind === 'proposal' && /\$35/.test(item.text));
  const output = renderSummaryItem(proposal);
  assert.match(output, /Surely|might/);
  assert.match(output, /I think you should spend \$35/);
  assert.equal(proposal.status, 'tentative');
});

test('visit fields preserve ambiguous raw time and make date corrections reviewable', () => {
  const summary = checked("I'm coming to visit.\nThursday the 14th.\nHow does 1030 sound?\nYes.\nI'll get the train.\nI sent the wrong date.\nSent the 13th not the 14th.\nNo, the 14th.");
  const visit = summary.items.find((item) => item.logistics);
  const output = renderSummaryItem(visit);
  assert.match(output, /Date mentioned: Thursday the 14th/);
  assert.match(output, /Time transcribed: 1030 \(check time \/ AM-PM\)/);
  assert.match(output, /Transport mentioned: train/);
  assert.match(output, /13th \/ 14th.*check conflicting wording/);
  assert.doesNotMatch(output, /10:30|2026|confirmed date/);
  assert.match(renderMeetingSummary(summary, { includeEvidence: true }), /Sent the 13th not the 14th/);
});

test('explicit AM-PM is retained, while multiple proposed times remain unresolved', () => {
  const first = checked("I'm coming to visit Monday.\nHow does 10:30am sound?\nYes.");
  assert.match(renderMeetingSummary(first), /10:30am \(proposed time\)/);
  assert.doesNotMatch(renderMeetingSummary(first), /check time \/ AM-PM/);
  const second = checked("I'm coming to visit Monday.\nHow does 1030 sound?\nHow does 1130 sound?");
  assert.match(renderMeetingSummary(second), /1030 \/ 1130 \(check multiple times\)/);
});

test('conditional travel is not presented as unconditional transport', () => {
  const summary = checked("We're coming to visit Tuesday.\nWe'll drive if the weather improves.");
  assert.match(renderMeetingSummary(summary), /drive \(conditional; check source\)/);
});

test('a price discussed during visit planning is not invented as a clock time', () => {
  for (const amount of ['$1030', '$ 1030', '1030 dollars']) {
    const summary = checked(`I'm coming to visit Monday.\nHow does ${amount} sound?`);
    assert.doesNotMatch(renderMeetingSummary(summary), /Time transcribed/);
  }
});

test('presentation validation rejects invented dates, dropped qualifiers and unsupported context', () => {
  const summary = checked("Topic: Release\nThe release thread is blocked.\nI'll check it.\nI'm coming to visit Monday.\nHow does 1030 sound?");
  const action = summary.items.find((item) => item.kind === 'action');
  action.actionContext.value = 'invoice';
  assert.ok(validateEvidence(summary).some((error) => /presentation or context/.test(error)));
  const visit = summary.items.find((item) => item.logistics);
  visit.presentation.fields.find((field) => field.label === 'Time transcribed').value = '10:30pm';
  assert.ok(validateEvidence(summary).some((error) => /presentation or context/.test(error)));
  const concern = checked('My concern is the supplier might not deliver.').items[0];
  concern.presentation.text = 'The supplier will deliver.';
  assert.ok(require('../public/js/summarizer').presentationIsGrounded(concern) === false);
});
