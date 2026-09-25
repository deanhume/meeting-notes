const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const { buildMeetingSummary, renderMeetingSummary } = require('../public/js/summarizer');
const { validateEvidence, extractWithLocalModel } = require('./local-summary-model');

const normalise = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

function containsPhrase(text, phrase) {
  const value = normalise(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${value}(?![\\p{L}\\p{N}])`, 'u').test(normalise(text));
}

function validateFixtures(fixtures) {
  if (!Array.isArray(fixtures) || !fixtures.length) throw new Error('Benchmark fixtures must be a non-empty array.');
  const ids = new Set();
  for (const fixture of fixtures) {
    if (!fixture || typeof fixture.id !== 'string' || ids.has(fixture.id) ||
        !['development', 'evaluation'].includes(fixture.split) || typeof fixture.transcript !== 'string' ||
        !Array.isArray(fixture.facts) || !fixture.facts.length) throw new Error('Invalid or duplicate benchmark fixture.');
    ids.add(fixture.id);
    const factIds = new Set();
    for (const fact of fixture.facts) {
      if (typeof fact.id !== 'string' || factIds.has(fact.id) ||
          !['discussion', 'decision', 'action', 'proposal', 'question'].includes(fact.kind) ||
          !Array.isArray(fact.phrases) || !fact.phrases.length ||
          fact.phrases.some((phrase) => typeof phrase !== 'string' || !phrase.trim() ||
            !containsPhrase(fixture.transcript, phrase))) {
        throw new Error(`Invalid fact annotation in ${fixture.id}.`);
      }
      factIds.add(fact.id);
    }
  }
  return fixtures;
}

function evaluateSummary(fixture, summary, output) {
  // Measure the displayed claims, not the evidence appendix or hidden candidates.
  const text = normalise(output);
  const results = fixture.facts.map((fact) => {
    const covered = fact.phrases.every((phrase) => containsPhrase(text, phrase));
    const matches = summary?.items.filter((item) => item.status !== 'superseded' &&
      fact.phrases.every((phrase) => containsPhrase(item.text, phrase))) || [];
    const status = fact.status || ({ action: 'confirmed', decision: 'confirmed', proposal: 'tentative', discussion: 'unclear', question: 'unclear' })[fact.kind];
    const correctRecord = summary ? covered && matches.some((item) =>
      item.kind === fact.kind && item.status === status &&
      (!Object.hasOwn(fact, 'owner') || item.owner === fact.owner) &&
      (!Object.hasOwn(fact, 'due') || item.due === fact.due)) : null;
    return { id: fact.id, kind: fact.kind, covered, correctRecord };
  });
  return {
    facts: results,
    missing: results.filter((fact) => !fact.covered).map((fact) => fact.id),
    incorrectRecords: summary ? results.filter((fact) => !fact.correctRecord).map((fact) => fact.id) : null,
    evidenceErrors: summary ? validateEvidence(summary) : null
  };
}

function loadBaseline(ref) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref)) throw new Error('Invalid baseline Git revision.');
  const cwd = path.resolve(__dirname, '..');
  const load = (file, dependencies = {}) => {
    const source = execFileSync('git', ['show', `${ref}:${file}`], { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    const context = { module: { exports: {} }, require: (name) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unsupported dependency in baseline: ${name}`);
      return dependencies[name];
    } };
    vm.runInNewContext(source, context, { timeout: 5000 });
    return context.module.exports;
  };
  const cleanup = load('public/js/transcript-clean.js');
  const summarizer = load('public/js/summarizer.js', { './transcript-clean': cleanup });
  return (text) => summarizer.summarizeToBullets(cleanup.finalizeTranscript(text));
}

function aggregate(rows) {
  const facts = rows.flatMap((row) => row.metrics.facts);
  const ratio = (subset) => ({
    covered: subset.filter((fact) => fact.covered).length,
    total: subset.length
  });
  return {
    factCoverage: ratio(facts),
    actionCoverage: ratio(facts.filter((fact) => fact.kind === 'action')),
    decisionCoverage: ratio(facts.filter((fact) => fact.kind === 'decision')),
    correctRecords: facts.some((fact) => fact.correctRecord === null) ? null : {
      correct: facts.filter((fact) => fact.correctRecord).length, total: facts.length
    },
    evidenceErrors: rows.some((row) => row.metrics.evidenceErrors === null) ? null :
      rows.flatMap((row) => row.metrics.evidenceErrors).length,
    durationMs: Math.round(rows.reduce((sum, row) => sum + row.durationMs, 0))
  };
}

function parseArguments(args) {
  const options = { fixtures: path.join(__dirname, '..', 'tests', 'fixtures', 'summary-meetings.json'), split: 'all' };
  const names = new Map([
    ['--fixtures', 'fixtures'], ['--split', 'split'], ['--baseline-ref', 'baselineRef'],
    ['--model', 'model'], ['--endpoint', 'endpoint'], ['--context', 'context']
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]);
    if (!name || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete argument: ${args[i]}`);
    options[name] = args[i + 1];
  }
  if (!['all', 'development', 'evaluation'].includes(options.split)) throw new Error('--split must be all, development or evaluation.');
  if ((options.endpoint || options.context) && !options.model) throw new Error('--endpoint and --context require --model.');
  return options;
}

async function runBenchmark(options) {
  const fixtures = validateFixtures(JSON.parse(fs.readFileSync(options.fixtures, 'utf8')))
    .filter((fixture) => options.split === 'all' || fixture.split === options.split);
  if (!fixtures.length) throw new Error('No fixtures matched the requested split.');
  const baseline = options.baselineRef ? loadBaseline(options.baselineRef) : null;
  const results = { contextual: [] };
  if (baseline) results.baseline = [];
  if (options.model) results.model = [];
  for (const fixture of fixtures) {
    const providers = [
      ['contextual', () => buildMeetingSummary(fixture.transcript)],
      ...(baseline ? [['baseline', () => baseline(fixture.transcript)]] : []),
      ...(options.model ? [['model', () => extractWithLocalModel(fixture.transcript, options)]] : [])
    ];
    for (const [provider, extract] of providers) {
      const start = performance.now();
      const value = await extract();
      const summary = typeof value === 'string' ? null : value;
      const output = summary ? renderMeetingSummary(summary) : value;
      results[provider].push({
        id: fixture.id, split: fixture.split, durationMs: Math.round(performance.now() - start),
        metrics: evaluateSummary(fixture, summary, output), output,
        ...(summary ? { records: summary.items } : {})
      });
    }
  }
  return {
    note: 'Synthetic phrase coverage and annotated record checks, not a semantic quality score. Evidence checks do not prove entailment. Real-meeting coverage, readability and human correction time still require review.',
    baselineRef: options.baselineRef || null,
    model: options.model || null,
    totals: Object.fromEntries(Object.entries(results).map(([provider, rows]) => [provider, aggregate(rows)])),
    results
  };
}

if (require.main === module) {
  Promise.resolve().then(() => runBenchmark(parseArguments(process.argv.slice(2))))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => { console.error(`Summary benchmark failed: ${error.message}`); process.exitCode = 1; });
}

module.exports = { validateFixtures, evaluateSummary, loadBaseline, aggregate, parseArguments, runBenchmark };
