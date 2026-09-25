const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { buildMeetingSummary, renderMeetingSummary } = require('../public/js/summarizer');
const {
  BRIEF_SCOPE, wordCount, extractionRequest, requiredContext, generateGroundedBrief
} = require('./grounded-summary');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const within = (candidate, directory) => {
  const relative = path.relative(directory, candidate);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function loadBenchmark(filename) {
  const resolved = fs.realpathSync(filename);
  const repository = fs.realpathSync(path.resolve(__dirname, '..'));
  if (within(resolved, repository)) throw new Error('Keep private brief benchmarks outside the repository.');
  const benchmark = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (benchmark.version !== 1 || typeof benchmark.transcriptPath !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(benchmark.transcriptSha256) ||
      typeof benchmark.referenceSummary !== 'string' || !benchmark.referenceSummary.trim() ||
      !Number.isInteger(benchmark.minWords) || !Number.isInteger(benchmark.maxWords) ||
      benchmark.minWords < 1 || benchmark.maxWords < benchmark.minWords ||
      !Array.isArray(benchmark.facts) || !benchmark.facts.length ||
      !Array.isArray(benchmark.reviewRules) || benchmark.reviewRules.some((rule) => typeof rule !== 'string')) {
    throw new Error('Invalid private benchmark manifest.');
  }
  const transcriptPath = fs.realpathSync(path.resolve(path.dirname(resolved), benchmark.transcriptPath));
  if (within(transcriptPath, repository)) throw new Error('Keep private transcripts outside the repository.');
  const bytes = fs.readFileSync(transcriptPath);
  if (hash(bytes) !== benchmark.transcriptSha256.toLowerCase()) throw new Error('Transcript changed since annotation; review the benchmark before running it.');
  const transcript = bytes.toString('utf8');
  const lines = transcript.split(/\r?\n/);
  const ids = new Set();
  for (const fact of benchmark.facts) {
    if (!fact || typeof fact.id !== 'string' || !fact.id || ids.has(fact.id) ||
        typeof fact.description !== 'string' || !fact.description.trim() ||
        !Array.isArray(fact.sourceLines) || !fact.sourceLines.length ||
        fact.sourceLines.some((range) => !Number.isInteger(range.start) || !Number.isInteger(range.end) ||
          range.start < 1 || range.end < range.start || range.end > lines.length)) {
      throw new Error('Invalid fact annotation or source line range.');
    }
    ids.add(fact.id);
  }
  return { benchmark, transcript, transcriptPath };
}

function assessLength(text, benchmark) {
  const count = wordCount(text.replace(/^- /gm, ''));
  return { words: count, target: [benchmark.minWords, benchmark.maxWords], withinTarget: count >= benchmark.minWords && count <= benchmark.maxWords };
}

async function runBriefBenchmark(options, fetchImpl = fetch) {
  const { benchmark, transcript, transcriptPath } = loadBenchmark(options.benchmark);
  const request = extractionRequest(transcript, BRIEF_SCOPE);
  const baseline = renderMeetingSummary(buildMeetingSummary(transcript));
  const report = {
    inference: 'not run',
    transcriptPath, transcriptSha256: benchmark.transcriptSha256.toLowerCase(),
    scope: BRIEF_SCOPE,
    sourceWords: wordCount(transcript),
    minimumExtractionContextBudget: requiredContext(request),
    reference: { text: benchmark.referenceSummary, ...assessLength(benchmark.referenceSummary, benchmark) },
    baseline: { text: baseline, ...assessLength(baseline, benchmark) },
    acceptance: {
      facts: benchmark.facts.map((fact) => ({ ...fact, result: 'not assessed' })),
      rules: benchmark.reviewRules,
      coverage: null,
      unsupportedClaims: null,
      correctionMinutes: null,
      note: 'These are human-review fields, not keyword scores. The reference summary and annotations are never supplied to the model.'
    }
  };
  if (options.model) {
    const start = performance.now();
    // Deliberately exclude the reference answer, annotations and sample-specific rules.
    const draft = await generateGroundedBrief(transcript, {
      model: options.model, endpoint: options.endpoint, context: options.context,
      scope: BRIEF_SCOPE, minWords: benchmark.minWords, maxWords: benchmark.maxWords
    }, fetchImpl);
    report.inference = 'completed; human review required';
    report.model = options.model;
    report.draft = {
      ...draft, ...assessLength(draft.text, benchmark),
      sha256: hash(draft.text), durationMs: Math.round(performance.now() - start)
    };
  }
  return report;
}

function parseBriefArguments(args) {
  const options = {};
  const names = new Map([['--benchmark', 'benchmark'], ['--model', 'model'], ['--endpoint', 'endpoint'], ['--context', 'context']]);
  for (let index = 0; index < args.length; index += 2) {
    const name = names.get(args[index]);
    if (!name || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete argument: ${args[index]}`);
    options[name] = args[index + 1];
  }
  if (!options.benchmark) throw new Error('--benchmark must point to a private JSON manifest outside the repository.');
  if (!options.model && (options.endpoint || options.context)) throw new Error('--endpoint and --context require --model.');
  return options;
}

if (require.main === module) {
  Promise.resolve().then(() => runBriefBenchmark(parseBriefArguments(process.argv.slice(2))))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.draft && !report.draft.withinTarget) process.exitCode = 1;
    })
    .catch((error) => { console.error(`Grounded brief benchmark failed: ${error.message}`); process.exitCode = 1; });
}

module.exports = { loadBenchmark, assessLength, runBriefBenchmark, parseBriefArguments };
