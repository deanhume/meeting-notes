const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { test } = typeof global.test === 'function' ? { test: global.test } : require('node:test');
const { createTranscriptSegments } = require('../public/js/summarizer');
const {
  hydrateFacts, hydrateDraft, extractionRequest, writingRequest,
  requiredContext, generateGroundedBrief
} = require('../scripts/grounded-summary');
const { loadBenchmark, runBriefBenchmark, parseBriefArguments } = require('../scripts/benchmark-brief');
const { extractWithLocalModel } = require('../scripts/local-summary-model');

const transcript = 'Casey will send the report by Friday.\nThe launch is blocked by the security review.';
const metadata = { details: { format: 'gguf' }, model_info: { 'general.parameter_count': 4000000000 } };
const fact = {
  id: 'F1', topic: 'Launch', kind: 'action', certainty: 'confirmed',
  text: 'Casey will deliver the report before the weekend.', owner: 'Casey', due: 'Friday',
  sourceRanges: [{ start: 'S1', end: 'S1' }]
};
const draft = {
  sections: [{
    heading: 'Action items / follow-ups',
    bullets: [{ text: 'Casey will send the report by Friday.', factIds: ['F1'] }]
  }]
};
const jsonResponse = (value) => ({ ok: true, json: async () => value });

function stubModel(extracted = { facts: [fact] }, rewritten = draft, modelInfo = metadata) {
  const requests = [];
  let stage = 0;
  return {
    requests,
    fetchImpl: async (url, request) => {
      requests.push({ url, ...request });
      if (url.endsWith('/api/show')) return jsonResponse(modelInfo);
      return jsonResponse({
        done: true, done_reason: 'stop',
        message: { content: JSON.stringify(stage++ === 0 ? extracted : rewritten) }
      });
    }
  };
}

async function withPrivateFixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-brief-test-'));
  const source = path.join(directory, 'source.txt');
  const filename = path.join(directory, 'benchmark.json');
  const benchmark = {
    version: 1, transcriptPath: source,
    transcriptSha256: crypto.createHash('sha256').update(transcript).digest('hex'),
    minWords: 5, maxWords: 30,
    referenceSummary: 'REFERENCE-ANSWER-ONLY: Casey sends the report on Friday.',
    facts: [{ id: 'a', description: 'ANNOTATION-ONLY: Do not leak this answer to the writer.', sourceLines: [{ start: 1, end: 1 }] }],
    reviewRules: ['PRIVATE-REVIEW-RULE: The source is authoritative.']
  };
  fs.writeFileSync(source, transcript);
  fs.writeFileSync(filename, JSON.stringify(benchmark));
  try { await run({ filename, source, benchmark }); }
  finally {
    fs.unlinkSync(filename);
    fs.unlinkSync(source);
    fs.rmdirSync(directory);
  }
}

test('grounded extraction permits paraphrasing but reconstructs exact source evidence', () => {
  const facts = hydrateFacts({ facts: [fact] }, createTranscriptSegments(transcript));
  assert.equal(facts[0].text, fact.text);
  assert.deepEqual(facts[0].evidence, [{ segmentId: 'S1', quote: 'Casey will send the report by Friday.' }]);
});

test('disjoint ranges can combine an earlier arrangement with its later correction', () => {
  const segments = createTranscriptSegments('The visit is on Tuesday.\nThe deployment is blocked.\nCorrection, the visit is on Wednesday.');
  const [result] = hydrateFacts({ facts: [{
    ...fact, owner: null, due: null,
    sourceRanges: [{ start: 'S3', end: 'S3' }, { start: 'S1', end: 'S1' }]
  }] }, segments);
  assert.deepEqual(result.evidence.map((entry) => entry.segmentId), ['S1', 'S3']);
});

test('unknown, backwards, excessively broad and malformed evidence ranges fail explicitly', () => {
  const segments = createTranscriptSegments(transcript);
  for (const sourceRanges of [
    [{ start: 'S1', end: 'S999' }], [{ start: 'S2', end: 'S1' }], [],
    [{ start: 'S1', end: 'S1', invented: true }]
  ]) assert.throws(() => hydrateFacts({ facts: [{ ...fact, sourceRanges }] }, segments));
  assert.throws(() => hydrateFacts({ facts: [{ ...fact, sourceRanges: [{ start: 'S1', end: 'S33' }] }] },
    createTranscriptSegments('Sentence.\n'.repeat(40))));
});

test('duplicate facts and invented structured owners or dates are rejected', () => {
  const segments = createTranscriptSegments(transcript);
  assert.throws(() => hydrateFacts({ facts: [fact, fact] }, segments), /duplicate/);
  assert.throws(() => hydrateFacts({ facts: [{ ...fact, owner: 'Someone else' }] }, segments), /owner/);
  assert.throws(() => hydrateFacts({ facts: [{ ...fact, due: 'Monday' }] }, segments), /due/);
});

test('rewriting must cite existing facts and must not silently drop extracted facts', () => {
  const facts = hydrateFacts({ facts: [fact, { ...fact, id: 'F2', owner: null, due: null }] }, createTranscriptSegments(transcript));
  assert.throws(() => hydrateDraft(draft, facts), /omitted extracted facts/);
  const bad = { sections: [{ heading: 'Launch', bullets: [{ text: 'Invented claim.', factIds: ['F999'] }] }] };
  assert.throws(() => hydrateDraft(bad, facts), /existing/);
  assert.throws(() => hydrateDraft({ sections: [{ heading: 'Launch', bullets: [] }] }, facts), /Invalid/);
});

test('model prose is never described as semantically validated merely because citations exist', async () => {
  const model = stubModel();
  const result = await generateGroundedBrief(transcript, { model: 'local-test' }, model.fetchImpl);
  assert.equal(model.requests.length, 3);
  assert.match(result.text, /Casey will send the report by Friday/);
  assert.match(result.semanticValidation, /human must check/);
  assert.equal(result.sections[0].bullets[0].evidence[0].quote, 'Casey will send the report by Friday.');
  for (const request of model.requests) assert.equal(request.redirect, 'error');
  const rewritePayload = JSON.parse(model.requests[2].body);
  assert.equal(rewritePayload.options.temperature, 0);
  assert.match(rewritePayload.messages[1].content, /Casey will send the report by Friday/);
  assert.ok(rewritePayload.format.properties.sections);
});

test('context overflow fails before sending any transcript', async () => {
  const model = stubModel();
  await assert.rejects(generateGroundedBrief(transcript.repeat(200), { model: 'local-test', context: 8192 }, model.fetchImpl), /context budget/);
  assert.equal(model.requests.length, 0);
  assert.ok(requiredContext(extractionRequest(transcript)) > 4096);
});

test('cloud models, non-local endpoints and unsupported model contexts are rejected', async () => {
  const model = stubModel(undefined, undefined, { ...metadata, remote_host: 'remote.invalid' });
  await assert.rejects(generateGroundedBrief(transcript, { model: 'local-test' }, model.fetchImpl), /Cloud/);
  assert.equal(model.requests.length, 1);
  await assert.rejects(generateGroundedBrief(transcript, { model: 'test:cloud' }, model.fetchImpl), /cloud/);
  await assert.rejects(generateGroundedBrief(transcript, { model: 'local-test', endpoint: 'https://remote.invalid' }, model.fetchImpl), /loopback/);
  const shortModel = stubModel(undefined, undefined, {
    ...metadata, model_info: { ...metadata.model_info, 'general.architecture': 'test', 'test.context_length': 8192 }
  });
  await assert.rejects(generateGroundedBrief(transcript, { model: 'local-test', context: 16384 }, shortModel.fetchImpl), /model-reported/);
  assert.equal(shortModel.requests.length, 1);
});

test('malformed or incomplete model responses fail instead of substituting a summary', async () => {
  for (const answer of [
    { done: true, done_reason: 'length', message: { content: '{}' } },
    { done: true, message: { content: 'not JSON' } },
    { done: true, message: { content: '{"facts":[]}' } }
  ]) {
    const fetchImpl = async (url) => jsonResponse(url.endsWith('/api/show') ? metadata : answer);
    await assert.rejects(generateGroundedBrief(transcript, { model: 'local-test' }, fetchImpl));
  }
});

test('an invalid extraction stops before the writing pass', async () => {
  const model = stubModel({ facts: [{ ...fact, owner: 'Invented' }] });
  await assert.rejects(generateGroundedBrief(transcript, { model: 'local-test' }, model.fetchImpl), /owner/);
  assert.equal(model.requests.length, 2);
});

test('private preparation requires no server and leaves semantic scores unassessed', async () => {
  await withPrivateFixture(async ({ filename }) => {
    const report = await runBriefBenchmark({ benchmark: filename }, async () => { throw new Error('Network must not run'); });
    assert.equal(report.inference, 'not run');
    assert.equal(report.acceptance.coverage, null);
    assert.equal(report.acceptance.facts[0].result, 'not assessed');
    assert.ok(report.baseline.text);
    assert.equal(report.draft, undefined);
  });
});

test('the reference answer, annotated facts and private review rules never enter model prompts', async () => {
  await withPrivateFixture(async ({ filename }) => {
    const model = stubModel();
    const report = await runBriefBenchmark({ benchmark: filename, model: 'local-test' }, model.fetchImpl);
    const requests = model.requests.map((request) => request.body).join('\n');
    for (const marker of ['REFERENCE-ANSWER-ONLY', 'ANNOTATION-ONLY', 'PRIVATE-REVIEW-RULE']) assert.ok(!requests.includes(marker));
    assert.equal(report.draft.withinTarget, true);
    assert.equal(report.acceptance.coverage, null);
    assert.equal(report.draft.sha256.length, 64);
  });
});

test('source changes invalidate the private benchmark instead of silently using stale annotations', async () => {
  await withPrivateFixture(async ({ filename, source }) => {
    fs.appendFileSync(source, '\nChanged.');
    assert.throws(() => loadBenchmark(filename), /changed since annotation/);
  });
});

test('reports reference and model word-budget misses without padding the output', async () => {
  await withPrivateFixture(async ({ filename, benchmark }) => {
    benchmark.minWords = 200;
    benchmark.maxWords = 300;
    fs.writeFileSync(filename, JSON.stringify(benchmark));
    const model = stubModel();
    const report = await runBriefBenchmark({ benchmark: filename, model: 'local-test' }, model.fetchImpl);
    assert.equal(report.reference.withinTarget, false);
    assert.equal(report.draft.withinTarget, false);
    assert.match(report.draft.text, /Casey/);
    assert.equal(report.acceptance.coverage, null);
  });
});

test('an external manifest cannot point back to a transcript inside the repository', async () => {
  await withPrivateFixture(async ({ filename, benchmark }) => {
    benchmark.transcriptPath = path.join(__dirname, 'fixtures', 'summary-meetings.json');
    fs.writeFileSync(filename, JSON.stringify(benchmark));
    assert.throws(() => loadBenchmark(filename), /private transcripts outside/);
  });
});

test('private benchmarks cannot be accidentally loaded from the repository', () => {
  assert.throws(() => loadBenchmark(path.join(__dirname, 'fixtures', 'summary-meetings.json')), /outside the repository/);
});

test('CLI rejects missing inputs, downloads and endpoint overrides without a model', () => {
  assert.throws(() => parseBriefArguments([]), /--benchmark/);
  assert.throws(() => parseBriefArguments(['--benchmark', 'private.json', '--download', 'yes']), /Unknown/);
  assert.throws(() => parseBriefArguments(['--benchmark', 'private.json', '--endpoint', 'http://127.0.0.1:11434']), /require --model/);
});

test('legacy extractive model mode still rejects paraphrases while grounded mode allows them', async () => {
  const legacy = {
    kind: 'action', status: 'confirmed', text: fact.text, owner: 'Casey', due: 'Friday',
    evidence: [{ segmentId: 'S1', quote: 'Casey will send the report by Friday.' }]
  };
  const fetchImpl = async (url) => jsonResponse(url.endsWith('/api/show') ? metadata :
    { done: true, message: { content: JSON.stringify({ items: [legacy] }) } });
  await assert.rejects(extractWithLocalModel(transcript, { model: 'local-test' }, fetchImpl), /verbatim/);
  legacy.text = legacy.evidence[0].quote;
  const result = await extractWithLocalModel(transcript, { model: 'local-test' }, fetchImpl);
  assert.equal(result.items[0].text, legacy.text);
  assert.ok(writingRequest(hydrateFacts({ facts: [fact] }, createTranscriptSegments(transcript))).instructions.includes('complete-sentence'));
});
