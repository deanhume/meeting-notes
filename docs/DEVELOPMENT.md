# Development Guide

## Prerequisites

- Node.js (v18 or higher)
- npm (comes with Node.js)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/deanhume/meeting-notes.git
   cd meeting-notes
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Download the speech-to-text model (for the in-app voice recording feature):
   ```bash
   npm run fetch-model
   ```
   This downloads the quantised (q4) Whisper-small.en ONNX model (~290 MB) into
   `public/models/whisper-small.en/`. It is not committed to git, but the build
   bundles it into the installer so end users never download anything. The Record
   button in the note editor stays hidden until the model is present. Transcription
   runs in the renderer via Transformers.js + ONNX Runtime Web — on the GPU (WebGPU)
   where available, falling back to CPU (WASM) automatically. It is fully automatic —
   there are no user-facing transcription settings.

## Running in Development Mode

Start the Electron app:
```bash
npm start
```

Or run as a web application (for testing the UI):
```bash
npm run web
```
Then open `http://localhost:3000` in your browser.

## Project Structure

```
meeting-notes/
├── main.js              # Electron main process
├── preload.js           # Electron preload script (IPC bridge)
├── server.js            # Express server (web mode only)
├── shared.js            # Shared validation, helpers, and API routes
├── package.json         # Project dependencies and scripts
├── public/
│   ├── index.html       # Main HTML file
│   ├── css/
│   │   ├── style.css    # Application styles
│   │   └── fonts.css    # Font definitions
│   ├── js/
│   │   └── app.js       # Frontend JavaScript
│   ├── fonts/           # Embedded fonts for offline use
│   │   ├── ibm-plex-sans-*.ttf
│   │   ├── ibm-plex-mono-*.ttf
│   │   └── playfair-display-*.ttf
│   └── images/
│       ├── logo.png     # Original logo (240x240)
│       └── logo-256.png # Resized logo for installer (256x256)
├── marketing/
│   └── index.html       # Marketing landing page
└── dist/                # Build output (generated)
```

## Key Files

- **main.js**: Electron main process that creates the window and manages the Express server
- **preload.js**: Secure bridge between Electron and the renderer process (for folder picker)
- **server.js**: Standalone Express server for web mode
- **shared.js**: Shared module containing validation, helpers, and API route factory used by both Electron and web server
- **public/js/app.js**: All frontend logic including API calls, UI interactions, and theme management
- **public/js/summarizer.js**: Evidence-backed extractive meeting records and Markdown rendering, shared by the browser and Node
- **public/js/transcript-clean.js**: Conservative transcript cleanup and chunk-seam helpers, shared by the browser and Node
- **public/css/style.css**: Complete styling for the application including light/dark theme support

## Data Storage

The application stores data in JSON files:

**Electron App:**
- Settings: `%APPDATA%\meeting-notes\settings.json`
- Data: Configurable location (default: `%APPDATA%\meeting-notes\data\`)
  - `people.json` - List of contacts
  - `questions.json` - Discussion questions
  - `notes_[personId].json` - Notes for each person

**Web Mode:**
- Data: Configurable location specified in `server.js`

## API Endpoints

### People
- `GET /api/people` - Get all people
- `POST /api/people` - Add a new person
- `PUT /api/people/:id` - Update a person
- `DELETE /api/people/:id` - Delete a person

### Notes
- `GET /api/people/:id/notes` - Get notes for a person
- `POST /api/people/:id/notes` - Add a note
- `PUT /api/people/:id/notes/:noteId` - Update a note
- `DELETE /api/people/:id/notes/:noteId` - Delete a note

### Questions
- `GET /api/questions` - Get all questions
- `PUT /api/questions` - Update questions

### Tags
- `GET /api/tags` - Get all unique tags used across all notes

### Settings
- `GET /api/settings` - Get current settings
- `PUT /api/settings/data-location` - Update data storage location

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the Electron app in development mode |
| `npm run dev` | Start in development mode (same as start) |
| `npm run fetch-model` | Download the Whisper speech-to-text model into `models/` |
| `npm run web` | Run as standalone web server (testing only) |
| `npm run benchmark:summary` | Evaluate synthetic summary fixtures locally; no model or network by default |
| `npm run benchmark:brief` | Prepare or run a private, evidence-backed rewriting benchmark; no network unless `--model` is supplied |
| `npm run build` | Build Windows installer with auto-updates |
| `npm run build:dir` | Build Windows to directory without installer |
| `npm run build:mac` | Build macOS installers (DMG and ZIP) with auto-updates |
| `npm run build:mac:dir` | Build macOS to directory without installer |
| `npm run build:all` | Build for both Windows and macOS with auto-updates |

## Evidence-backed summarisation

`buildMeetingSummary(transcript)` returns
`{ version, segments, items, topics, highlights, briefHighlights }`.
Each source segment has a stable ordinal ID (`S1`, `S2`, ...); every extracted
item has a kind, status, original `text`, compacted `displayText`, a `facet`,
source-bound `presentation`, topic, nullable owner/due date, evidence
quotes and an optional `supersedes` reference. IDs remain stable when complete
segments are appended, not when the original text is edited.

Initial chunk-seam reconstruction joins up to five source segments / 65 words
(an already-long original segment is not truncated). It preserves short answers,
negation, uncertainty and corrections, then extracts conservative commitments.
Repeated source bigrams/trigrams provide topic labels; overlapping phrases and
plural variants are merged. Recurring capitalised names are a fallback when no
strong phrases exist; name-only labels are not assigned by proximity alone.
Topics are mined before adding follow-up context,
so quoting the same source twice cannot manufacture a recurring topic.
Explicit agenda headings override inferred grouping.

Passage scoring considers distinct work signals, concrete follow-ups, completed
work, concerns and proposals, rather than rewarding repeated keywords or giving
every fragment a selection quota. Nearby explicit examples are down-weighted
and are not classified as real commitments. Live demonstration checks are not
treated as follow-ups. The selector uses marginal coverage of topic/facet pairs
and new content, not just independent sentence scores. Facets distinguish, for
example, delivery risk, responsibility, status, capacity, allocation, alternatives
and completed work. Repeated background gets diminishing value and, in longer
meetings, at most two slots per topic unless there is an explicit correction.
Full/brief selection shares a 360/220-word
budget with at most 20/7 optional facts. Recognised actions, decisions and
dated visit bundles are retained even when they exceed that budget. Optional
proposals and questions are ranked alongside discussion. Headings and the
evidence appendix are not part of the budget.
Follow-up context and quoted visit bundles can contain additional source segments.
The budget is measured against `renderSummaryItem`, including clarification and
review labels, rather than the longer underlying evidence. Related resource
facts can share a bullet without changing their wording.

`presentation` is separate from the source-preserving `displayText`. A bounded
set of templates can quote an independent contrast clause, shorten a completed
artifact or a proposal, or present visit fields. Scope guards prevent lifting a
clause out of a qualifier such as "I think", "only" or a condition. Source text and
quotes remain available even when a presentation omits redundant wording.
Incomplete contact/scope fragments are explicitly marked, not completed by code.

Vague actions are not deduplicated before their objects are known. Clarification
uses one unambiguous nearby artifact mention, or a quoted local topic phrase,
without crossing explicit agenda boundaries or assigning a contact as an owner.
An adjacent, narrowly recognised request for findings remains labelled
"not confirmed". Conditional commitments are proposals rather than unconditional
actions; an embedded question such as "I'll check if..." is not a condition.
Identical status text in different explicit topics remains separate.

Only adjacent, explicit corrections
with matching subject words (or a short "instead" correction) can supersede a
record. Conflicting statements without that evidence remain separate for review.
Tentative corrections remain proposals and do not cancel a confirmed commitment.
`displayIsExtractive` checks source-token order plus preservation of important
qualifiers, negation and numbers; benchmark validation applies it to display text
as well as checking original evidence. `presentationIsGrounded` additionally checks
context/request references and regenerates the permitted presentation from its
source inputs to detect unsupported changes. Neither check proves semantic
equivalence, correct context resolution or complete fact coverage.
Visit fields retain raw times, exclude explicit prices, and flag multiple dates/times, conditions and
corrections without guessing missing AM/PM, month, year or a final date.
Inferred headings are contextual
hints, not verified project attribution.
This is heuristic extraction, not semantic understanding or speaker diarisation.

`renderMeetingSummary(summary, { brief, includeEvidence })` renders Markdown.
`summarizeToBullets(transcript, options)` remains the string-returning entry point.
The browser loads `transcript-clean.js` before `summarizer.js`; both retain their
CommonJS exports for tests. `transcriptRead({ raw: true })` supplies stored source
text before filtering, while `transcriptRead()` retains its finalised-text
contract. The optional model experiment is **not** loaded by the application.
There are no new summarisation weights, runtime dependencies or downloads.

The passage/selection regressions also run without Jest:

```powershell
node --test tests\summary-passages.test.js tests\summary-facts.test.js
```

These invented cases cover broken speech boundaries, plural work signals,
completed downloads, suggested purchases, transport jokes, word budgets and
preservation of qualifiers. Fact tests also cover repeated introductions versus
distinct constraints, ambiguous referents, contact/owner separation, conditional
follow-ups and tampered presentations. They contain no private meeting text.

### Synthetic quality benchmark

Run with Node 22+:

```powershell
npm run benchmark:summary
npm run benchmark:summary -- --split development
npm run benchmark:summary -- --split evaluation
npm run benchmark:summary -- --baseline-ref 0f96fdea5c9f8c08d94b40db049cbf46837b7713
```

The Git comparison reads the old summariser and cleanup module without changing
the worktree. The baseline revision must exist locally. The report includes
outputs and records for review, annotated fact/action/decision phrase coverage,
exact record classification and owner/due-date checks, evidence-validation errors,
and elapsed extraction/rendering time. The old string-only baseline cannot be
scored for structured-record or source-evidence correctness; those metrics are
`null`, not zero errors.

The 12 fixtures in `tests/fixtures/summary-meetings.json` are short, invented
meeting excerpts: eight development cases and four separately labelled
evaluation cases. They are regression examples, **not** a representative
real-meeting or blinded held-out benchmark. Phrase coverage checks preserve
annotated numbers and dates, but cannot establish semantic accuracy.
Verbatim source checks cannot establish that a passage actually supports a
classification or owner assignment. Review the records and their context.

For later real-meeting evaluation, create a local JSON file with the same schema
and use `--fixtures "C:\path\private-meetings.json"`. Keep private fixtures and
reports outside the repository. Include positive, negative and corrected
decisions, deadlines, unknown speakers, longer meetings and personal context.
Annotate must-keep facts before tuning and reserve some meetings for genuinely
held-out evaluation. Measure human correction time separately; the automated
report does not claim to measure it.

### Optional local-model comparison (no automatic downloads)

The `--model` option uses an already-running Ollama server and already-installed
local GGUF weights. Nothing installs, pulls a model or changes app packaging.
Use a stronger instruction model only as a bounded comparison against the same
fixtures; no model is enabled in the production app on the strength of these
synthetic results.

Before using the harness, run a local-only server with cloud features disabled:

```powershell
$env:OLLAMA_NO_CLOUD = '1'
ollama serve
```

In a separate terminal, using the exact name of your installed local model:

```powershell
npm run benchmark:summary -- --model "your-installed-local-model" --split development
npm run benchmark:summary -- --model "your-installed-local-model" --context 32768
```

The default endpoint is `http://127.0.0.1:11434`. An optional `--endpoint` accepts
only literal HTTP loopback addresses; redirects and cloud/proxy model metadata
are rejected. The server must report local GGUF model information before any
transcript is sent. The harness relies on a trusted, locally controlled server;
do not substitute a forwarding proxy.

Requests use a JSON schema and temperature zero. Output text must remain a
verbatim, contiguous source passage (up to four segments), with exact citations
and explicitly supported owner/date strings. Malformed JSON, invented text,
unknown citations, server errors and truncated output fail the run rather than
silently falling back to the code-only summary. Schema validity and source
matching still do not prove factual entailment.

A conservative byte-based input budget reserves room for output and rejects
oversized meetings before inference. Increase `--context` only within the
model/hardware's capacity, or use a shorter annotated meeting; no input is
silently truncated and there is no lossy summary-of-summaries reduction.
This harness intentionally does not yet solve cross-window long-meeting
extraction. Inspect real coverage and correction time before considering app
integration.

Protocol references: `https://docs.ollama.com/api/chat`,
`https://docs.ollama.com/capabilities/structured-outputs`,
and `https://docs.ollama.com/faq`.

### Private project-brief benchmark

`benchmark:summary` above still compares extractive output. Its synthetic phrase
scores are **not** evidence that it produces a useful real-meeting brief.
`benchmark:brief` is a separate experiment for concise, rewritten topical notes,
not a production summariser change.

Keep the transcript, reference summary and annotations outside the repository.
The runner enforces this for the manifest and transcript, including resolved
symlink paths. A private JSON manifest has this shape:

```json
{
  "version": 1,
  "transcriptPath": "C:\\private\\meeting.txt",
  "transcriptSha256": "<64-character SHA-256 of the original file bytes>",
  "minWords": 200,
  "maxWords": 300,
  "referenceSummary": "A manually written target brief.",
  "facts": [
    {
      "id": "release-follow-up",
      "description": "The report is due Friday; its owner is explicitly named.",
      "sourceLines": [{ "start": 12, "end": 17 }]
    }
  ],
  "reviewRules": [
    "Preserve uncertainty, corrections and the difference between suggestions and commitments.",
    "Omit social conversation; check all must-keep facts and unsupported claims manually."
  ]
}
```

Source line ranges are 1-based and inclusive. The original byte hash prevents
accidentally evaluating changed input against stale annotations. A reference
summary is a style/coverage target, not unquestionable truth: note ambiguities
or overconfident wording in the review annotations.

Preparation performs **no network requests**, requires no model, and reports the
existing summariser's output and length against the reference:

```powershell
npm run benchmark:brief -- --benchmark "C:\private\benchmark.json"
```

Redirect reports only to a private location outside the repository; reports can
contain transcript quotations and the reference summary. Annotated coverage,
unsupported claims and correction time remain `null` until human assessment;
the runner does not substitute keyword overlap for semantic quality.

If a local runtime and model are separately installed and approved for use:

```powershell
npm run benchmark:brief -- --benchmark "C:\private\benchmark.json" --model "your-installed-local-model" --context 65536
```

This reuses the loopback-only Ollama checks described above and never downloads a
runtime or model. It makes two model calls:

1. Locate and consolidate scope-relevant facts across the whole transcript,
   separating actions, suggestions, completed work, risks, preferences and
   uncertainties. Facts reference small source ranges, including disjoint ranges
   for a later correction. Exact source quotations are attached by code rather
   than invented or retyped by the model.
2. Rewrite those facts into short topical sections and follow-ups. Every bullet
   references fact IDs, and every extracted fact must be cited. The writer also
   receives the original supporting quotations, not just a lossy intermediate
   summary.

The **reference answer, annotated must-keep facts and sample-specific review
rules never enter either prompt**. Both passes use the same generic project-brief
scope. Paraphrasing is allowed in this mode; the original extractive harness
retains its stricter verbatim contract.

Malformed responses, unknown references, dropped fact IDs, fabricated
owner/deadline strings, oversized evidence ranges, unavailable local models and
context-budget failures are explicit errors, not fallback summaries. The runner
reports a word-budget miss and exits nonzero while retaining the draft in its
JSON report. It never truncates the submitted transcript to fit the requested
context; a conservative byte budget is checked before each pass. The default
context request is 65,536, which must be supported by the chosen model and
hardware. A model-reported smaller context limit is rejected.

**Valid citations and fact IDs are not proof of entailment or coverage.** A
rewritten bullet could cite the right fact but misstate its meaning; the first
pass could also omit a real commitment. Every model draft is therefore labelled
as requiring human review. Review the private checklist, exact names/numbers,
uncertainty, final corrected dates, readability and correction time before
considering integration. No model-generated quality result should be claimed
when only the preparation command or stubbed protocol tests have run.

The grounded experiment's protocol and isolation checks can run without Jest or
any additional dependencies:

```powershell
node --test tests\grounded-summary.test.js
```

That file also registers with Jest when run as part of the normal suite. Its
synthetic model responses check the implementation contract, not model quality.

### Small-model trial: 2026-09-24

An actual local trial used **Qwen3.5-0.8B Q4_0** with the portable Windows ARM64
CPU build of **llama.cpp b11146**. Model weights were 563,036,064 bytes and the
runtime archive was 12,034,624 bytes: about **575 MB total download**, within the
approved 500-1000 MB range. This was a developer-only experiment; neither the
model nor runtime was added to the app or repository.

On one real 4,675-word transcript, the grounded extraction repeated itself under
greedy decoding. Using the model author's text sampling settings avoided the
loop but produced fabricated owners and irrelevant source selections, which
the evidence validator rejected. Direct prose prompts were also tried. The
lower-temperature retry recognised some relevant topics but still invented
project details, reversed a technical concern, and omitted important follow-ups.
This was a factual-quality failure, not an exact-wording mismatch.

The direct run took about 26 seconds; a shorter, prompt-cached retry took about
10 seconds. Observed peak working set was about 2.46 GiB with a 65,536-token
context configured and eight CPU threads. Those are measurements on the trial
machine, not minimum hardware requirements or performance guarantees.

The candidate was **not integrated**. Private prompts, reference annotations
and model outputs remain outside the repository. This result concerns one
model/quantisation/runtime combination and one transcript, not all sub-1-GB
models. Future candidates must still be judged against actual meeting facts and
the total added download footprint rather than synthetic phrase scores alone.

A second trial on the same date tested **SmolLM2-1.7B Instruct IQ4_XS**, with
940,397,536 bytes of weights and the same runtime: **952,432,160 bytes combined**.
Its native 8,192-token context was respected, with token-count checks before
requests and no silent input truncation.

The full-transcript attempt described the requested format instead of producing
notes. A relevance classifier retained every source window and did not solve the
context problem. Selecting a few source-line anchors per window reduced the
writer's input, but the resulting brief reversed an attribution, invented
follow-ups and missed required arrangements. A separately labelled diagnostic
gave the writer only original passages identified by the benchmark annotations,
without the reference prose or fact descriptions; it still copied and repeated
source text until reaching the output limit. That last diagnostic is deliberately
**not** an end-to-end benchmark result because the passage selection was supplied.

This second candidate was also not integrated. The failure concerned factual
content and instruction following, not exact wording or a strict word-count
match. All actual source data, prompts and outputs remain outside the repository.
