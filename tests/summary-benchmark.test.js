const fixtures = require('./fixtures/summary-meetings.json');
const { buildMeetingSummary, renderMeetingSummary } = require('../public/js/summarizer');
const { evaluateSummary, validateFixtures, parseArguments, aggregate } = require('../scripts/benchmark-summary');
const { localEndpoint, extractWithLocalModel, validateEvidence } = require('../scripts/local-summary-model');

describe('summary quality benchmark', () => {
  test('validates annotations against their synthetic transcripts', () => {
    expect(validateFixtures(fixtures)).toBe(fixtures);
    expect(() => validateFixtures([{ ...fixtures[0], facts: [{ id: 'bad', kind: 'action', phrases: ['invented'] }] }])).toThrow();
  });

  test('covers annotated facts and exact record attributes without unsupported evidence', () => {
    const rows = fixtures.map((fixture) => {
      const summary = buildMeetingSummary(fixture.transcript);
      return { metrics: evaluateSummary(fixture, summary, renderMeetingSummary(summary)), durationMs: 0 };
    });
    const totals = aggregate(rows);
    expect(totals.factCoverage.covered).toBe(totals.factCoverage.total);
    expect(totals.correctRecords.correct).toBe(totals.correctRecords.total);
    expect(totals.evidenceErrors).toBe(0);
  });

  test('does not count a hidden candidate as a displayed fact', () => {
    const fixture = fixtures[0];
    const summary = buildMeetingSummary(fixture.transcript);
    expect(evaluateSummary(fixture, summary, '').missing).toHaveLength(fixture.facts.length);
  });

  test('detects a wrong owner even when the prose contains the expected words', () => {
    const fixture = fixtures[0];
    const summary = buildMeetingSummary(fixture.transcript);
    summary.items.find((item) => item.kind === 'action').owner = 'Sarah';
    const metrics = evaluateSummary(fixture, summary, renderMeetingSummary(summary));
    expect(metrics.incorrectRecords).toContain('checklist');
    expect(metrics.evidenceErrors.length).toBeGreaterThan(0);
  });

  test('distinguishes unavailable baseline evidence checks from zero errors', () => {
    expect(evaluateSummary(fixtures[0], null, 'Nothing here.').evidenceErrors).toBe(null);
  });

  test('does not count a changed number as coverage of the original fact', () => {
    const fixture = { facts: [{ id: 'budget', kind: 'decision', phrases: ['approved 100'] }] };
    expect(evaluateSummary(fixture, null, 'We approved 1000.').missing).toEqual(['budget']);
  });

  test('rejects unknown CLI arguments and invalid splits', () => {
    expect(() => parseArguments(['--split', 'other'])).toThrow();
    expect(() => parseArguments(['--model'])).toThrow();
    expect(() => parseArguments(['--download', 'yes'])).toThrow();
    expect(() => parseArguments(['--endpoint', 'http://127.0.0.1:11434'])).toThrow();
  });
});

describe('optional local model extraction', () => {
  const metadata = { details: { format: 'gguf' }, model_info: { 'general.parameter_count': 4000000000 } };
  const response = (value) => ({ ok: true, json: async () => value });
  const transcript = 'Priya will send the checklist by Friday.';
  const item = {
    kind: 'action', status: 'confirmed', text: transcript, owner: 'Priya', due: 'Friday',
    evidence: [{ segmentId: 'S1', quote: transcript }]
  };

  test('only accepts literal loopback endpoints without credentials or redirects', () => {
    expect(localEndpoint()).toBe('http://127.0.0.1:11434');
    expect(localEndpoint('http://[::1]:11434')).toBe('http://[::1]:11434');
    for (const endpoint of ['https://example.com', 'http://127.0.0.1.example.com', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/path']) {
      expect(() => localEndpoint(endpoint)).toThrow();
    }
  });

  test('validates exact source quotations and metadata', () => {
    const summary = buildMeetingSummary(transcript);
    summary.items[0].evidence[0].quote = 'Priya will send the checklist by Monday.';
    expect(validateEvidence(summary).length).toBeGreaterThan(0);
  });

  test('sends the schema and deterministic options only to a confirmed local model', async () => {
    const calls = [];
    const fetchImpl = async (url, request) => {
      calls.push({ url, request });
      return response(url.endsWith('/api/show') ? metadata : {
        done: true, done_reason: 'stop', message: { content: JSON.stringify({ items: [item] }) }
      });
    };
    const summary = await extractWithLocalModel(transcript, { model: 'local-test' }, fetchImpl);
    expect(summary.items[0]).toMatchObject(item);
    expect(calls).toHaveLength(2);
    const request = JSON.parse(calls[1].request.body);
    expect(request.stream).toBe(false);
    expect(request.options.temperature).toBe(0);
    expect(request.format.properties.items).toBeDefined();
    expect(calls[1].request.redirect).toBe('error');
  });

  test('rejects cloud aliases before sending a transcript', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return response({ ...metadata, remote_host: 'example.com' }); };
    await expect(extractWithLocalModel(transcript, { model: 'local-test' }, fetchImpl)).rejects.toThrow(/Cloud/);
    expect(calls).toBe(1);
    await expect(extractWithLocalModel(transcript, { model: 'test:cloud' }, fetchImpl)).rejects.toThrow(/cloud/);
    expect(calls).toBe(1);
  });

  test('rejects oversized input instead of silently truncating it', async () => {
    let calls = 0;
    await expect(extractWithLocalModel(transcript.repeat(500), { model: 'local-test' }, async () => { calls += 1; }))
      .rejects.toThrow(/context budget/);
    expect(calls).toBe(0);
  });

  test('rejects incomplete responses and hallucinated evidence, without falling back', async () => {
    for (const result of [
      { done: true, done_reason: 'length', message: { content: '{}' } },
      { done: true, message: { content: 'not JSON' } },
      { done: true, message: { content: JSON.stringify({ items: [{ ...item, owner: 'Sarah' }] }) } },
      { done: true, message: { content: JSON.stringify({ items: [{ ...item, text: 'Priya will send it by Monday.' }] }) } }
    ]) {
      const fetchImpl = async (url) => response(url.endsWith('/api/show') ? metadata : result);
      await expect(extractWithLocalModel(transcript, { model: 'local-test' }, fetchImpl)).rejects.toThrow();
    }
  });

  test('reports server failures explicitly', async () => {
    await expect(extractWithLocalModel(transcript, { model: 'local-test' }, async () => ({ ok: false, status: 404 })))
      .rejects.toThrow(/HTTP 404/);
  });
});
