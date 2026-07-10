# Copilot Instructions — Meeting Notes

Electron desktop app for tracking meeting notes about people in your organization. File-based JSON storage, Node.js/Express backend, vanilla-JS frontend (no framework, no bundler). Can also run as a plain web server for UI development.

## Commands

```bash
npm start          # Launch the Electron app (alias: npm run dev)
npm run web        # Run as a standalone Express server at http://localhost:3000
npm run fetch-model # Download the bundled Whisper STT model (onnx-community/whisper-small.en q4, ~290 MB) into public/models/
npm test           # Run the full Jest suite
npm run build      # Build the Windows NSIS installer (electron-builder)
```

Run a single test file or test by name:

```bash
npx jest tests/api.test.js                     # one file
npx jest -t "POST /api/people creates a person" # one test by name
```

CI (`.github/workflows/test.yml`) runs `npm ci && npm test` on Node 22 for pushes/PRs to `main`.

## Architecture

The core design is a **single API route factory shared by two hosts**:

- `shared.js` exports `createApiRoutes(expressApp, { dataDir })` plus validation/helpers. This is the only place API endpoints and persistence logic live.
- `main.js` (Electron main process) creates the `BrowserWindow`, starts an embedded Express server, and calls `createApiRoutes`. Settings/data live under the Electron `userData` dir (`%APPDATA%/meeting-notes/`).
- `server.js` is a thin standalone Express host for web mode that calls the same `createApiRoutes`.
- `preload.js` is the IPC bridge; the renderer runs with `nodeIntegration: false` and `contextIsolation: true`, so only explicitly exposed APIs reach the frontend. It exposes exactly `window.electronAPI.{selectFolder, transcriptionAvailable, transcriptStart, transcriptAppend, transcriptRead, checkForUpdates, getUpdateStatus}` via `contextBridge` — add any new renderer↔main capability here plus a matching `ipcMain.handle` in `main.js`.
- **Transcription runs in the renderer**, not the main process, because WebGPU only exists in Chromium. `public/js/transcriber.js` is an ES module that loads Transformers.js + ONNX Runtime Web (vendored offline under `public/vendor/transformers/`) and runs the quantised (q4) Whisper-small.en model on the **GPU (WebGPU)** where available, transparently falling back to **CPU (WASM)** otherwise. It exposes `window.rendererTranscription.{transcribe, warmup, getBackend, hasWebGPU, isAvailable}` for the classic-script `app.js`. dtype is **q4** deliberately — fp16 whisper throws a numeric ONNX Runtime WASM abort on WebGPU. Everything is bundled/served locally (import map in `index.html` maps `onnxruntime-common` + `onnxruntime-web/webgpu` to vendored files); nothing is fetched from the network. The Electron/web hosts send `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` so ORT can use threaded WASM. **Load-order gotcha:** `transcriber.js` is a deferred ES module, so `window.rendererTranscription` is set only *after* its Transformers.js import resolves — which is *after* the classic `app.js` has already run `init()`. It therefore dispatches a `rendererTranscriptionReady` event once its API is installed, and `app.js`'s `wireRecordButton` awaits that (via `transcriptionReady()`, with a timeout) before revealing the Record button. Don't assume the global exists at `app.js` startup.
- `transcription.js` (Electron main process) is now a thin helper: `isModelAvailable(app)` (gates the Record button — it checks the bundled ONNX model at `public/models/` in dev, or `process.resourcesPath/models/` when `app.isPackaged`, since the model ships outside the asar via `extraResources`), `computeThreads`, and re-exports of `cleanTranscript`/`finalizeTranscript` from the shared cleanup module. It no longer runs any model. Voice/transcription is still Electron-only (it relies on the Electron-only transcript-file IPC for the live summary).
- `transcript-file.js` (Electron main process) exports `getTranscriptFilePath(dataLocation, noteId)`, which resolves the per-recording transcript file under a `transcriptions/` subfolder of the data dir. When a valid note ID is passed to `transcript-start`, the file is note-linked as `transcription_<noteId>.txt`, so repeated recordings for the same note append to one file. **Packaging gotcha:** `main.js` `require`s `./transcript-file`, so it must stay in electron-builder's `files` allowlist in `package.json` — omitting it excludes it from `app.asar` and the installed app crashes with `Cannot find module ./transcript-file` (the 1.2.3 fix). Keep any new top-level `require`d module in that allowlist too.
- `public/js/transcript-clean.js` is a **dual-mode module** (like `summarizer.js`: `window` global for the browser + `module.exports` for Node/Jest) holding the pure Whisper text-cleanup helpers (`cleanTranscript`, `finalizeTranscript`, etc.). The renderer cleans raw transcripts with it before appending; `transcription.js` re-exports it for `transcript-read` and tests. Keep the dual export when editing.
- `public/js/app.js` is all frontend logic (DOM manipulation, `fetch` calls, theme, modals). `public/css/style.css` holds theming via CSS custom properties.
- `public/js/summarizer.js` turns a raw transcript into bullet points using a fully on-device **extractive** algorithm (sentence cleanup + TextRank-style similarity scoring + signal boosting) — no LLM, no network. It is a **dual-mode module**: it attaches to `window` for the browser and also `module.exports` its functions (guarded by `typeof module !== 'undefined'`) so it can be unit-tested in Node without a browser. Keep this dual export when editing.

When changing API behavior, edit `shared.js` once — both Electron and web mode inherit it. Tests in `tests/api.test.js` exercise `createApiRoutes` against a temp `dataDir`, and `tests/shared.test.js` covers the helpers — so no Electron is needed to test the API or persistence layer. `tests/summarizer.test.js` and `tests/transcription.test.js` cover the summarization and transcription helpers directly via their CommonJS exports.

## Data model

JSON files in the configured data dir:

- `people.json` — array of `{id, name, role, team, createdAt}`
- `questions.json` — array of discussion questions
- `notes_<personId>.json` — array of `{id, title, content, tags, createdAt, updatedAt}` per person
- `settings.json` — data location + theme (Electron only).

Key API surface: `/api/people`, `/api/people/:id/notes`, `/api/questions`, `/api/tags`, `/api/settings`.

## Conventions

- **Atomic writes**: persist data with `atomicWriteFile` (temp file + rename). Never write a data file directly.
- **Reads**: use `safeLoadJSON(path, default)` — it tolerates missing/corrupt files.
- **IDs**: generate with `generateId()` (12-char hex via `crypto.randomBytes(6)`); validate with `validateId`.
- **Input**: sanitize/trim with `sanitizeString`; validate via the `validate*` helpers in `shared.js` before persisting. Tags are lowercase, max 20 per note, ≤50 chars each.
- **HTTP**: 200/201 success, 400 validation (`{ error: "message" }`), 404 not found.
- **Cascading delete**: deleting a person must remove their `notes_<id>.json` file.
- **No async/await** in the persistence layer — file I/O is synchronous by design. (Transcription in `transcription.js` is the exception: it is async because Whisper is.)
- **Voice transcription**: audio is captured in the renderer, downsampled to 16kHz mono Float32 PCM, and transcribed **in the renderer** by `window.rendererTranscription.transcribe` (Transformers.js/WebGPU, WASM fallback) — never leaving the machine. Raw output is cleaned with `window.cleanTranscript` (from `transcript-clean.js`) then appended to the transcript file via `transcriptAppend` IPC. The transcript can be condensed into bullet points by `summarizeToBullets` in `public/js/summarizer.js` (also on-device). The Record button stays hidden until `transcriptionAvailable` reports the bundled ONNX model is present. `app.js` calls `rendererTranscription.warmup()` when recording starts so the ~290 MB model loads ahead of the first chunk.
- **Speech-to-text model**: a single fixed model — `onnx-community/whisper-small.en`, quantised to **q4** (~290 MB, English-only, ONNX) — is used for everyone. `npm run fetch-model` downloads it into `public/models/whisper-small.en/` (Transformers.js local-model layout). It ships via `package.json` `extraResources` (kept out of the asar with a `!public/models/**` files-exclusion, then served at `/models` from `resourcesPath` in packaged builds) so end users never download anything. The Transformers.js runtime + ORT `asyncify` WASM are vendored under `public/vendor/transformers/` (~23 MB, in the asar). There is no user-facing transcription settings UI — it's fully automatic. Keep `fetch-model.js`'s file list, the model id/dtype in `transcriber.js`, `transcription.js`'s `isModelAvailable` path, and the `extraResources` entry in sync.
- **Frontend**: vanilla JS only; modal-based create/edit; toggle visibility with the `hidden` class; persist UI prefs (theme) in `localStorage`; notes shown newest-first; autosave fires every 20 keystrokes.

## Adding an endpoint

Add the route inside `createApiRoutes` in `shared.js`: load with `safeLoadJSON`, validate input, mutate, persist with `atomicWriteFile`, return the right status + JSON. Add a matching test in `tests/api.test.js`.

## Docs

See `docs/` for deeper guides: `DEVELOPMENT.md`, `BUILDING.md`, `USAGE.md`, `AUTO_UPDATES.md`, `RELEASE_CHECKLIST.md`. Note `package.json` currently only defines Windows build scripts despite mac references in some docs.

## Rejected approaches (do not re-propose)

- **Windows AI / Copilot+ on-device summarisation** (`@microsoft/windows-ai-electron`, Phi Silica `TextSummarizer.SummarizeConversationAsync`). This was prototyped and deliberately **rejected** — do **not** suggest or re-implement it unless the maintainer explicitly asks. Reasons:
  - **Too few Copilot+ PCs to be worth it.** The feature only runs on Copilot+ hardware (40+ TOPS NPU: Snapdragon X, Intel Core Ultra 200V, AMD Ryzen AI 300). The vast majority of users would never hit the AI path, so it adds complexity for little real-world benefit. *(User decision, 2026-06-26: "There aren't enough copilot+ pcs to make this viable… too complex for the app's needs.")*
  - **Heavy packaging cost.** Activating it requires **package identity** (the default NSIS installer is identity-less), pulling in `@microsoft/winappcli`, an `appxmanifest` with the `systemAIModels` capability, a separate signed **MSIX** build target, and code-signing — none of which the app otherwise needs.
  - **Conflicts with auto-update.** MSIX uses a different update mechanism than the app's existing `electron-updater` + GitHub Releases flow, so it can't cleanly replace the primary distribution channel.
  - The bundled **extractive summariser** (`public/js/summarizer.js`) already covers the meeting-summary need on all hardware with no extra dependencies — prefer extending it over reaching for on-device LLM APIs.

- **Chrome built-in Summarizer API** ([Gemini Nano](https://developer.chrome.com/docs/ai/summarizer-api), the `Summarizer` global). Investigated and deliberately **rejected** — do **not** suggest or re-implement it unless the maintainer explicitly asks. It *is* on-device (Gemini Nano, downloaded once, no network for inference), but it doesn't fit this app. Reasons:
  - **Not available in the primary Electron host.** The `Summarizer` global ships with *Google Chrome* (component updater / on-device model), not with plain Chromium/Electron, so `'Summarizer' in self` is `false` in `main.js`'s `BrowserWindow`. It would only work in **web mode** (`npm run web`) opened in **Chrome 138+** — a small slice of users.
  - **Heavy requirements.** Chrome 138+, ~22 GB free disk, and either >4 GB VRAM GPU or 16 GB RAM + 4 cores — versus the current zero-dependency summariser that runs everywhere.
  - **API shape mismatch.** It's fully **async** (`Summarizer.create()` / `.summarize()` return promises) and needs **user activation** for the first model download, which clashes with the synchronous `summarizeToBullets` and the 30s live-summary auto-refresh loop. Non-deterministic output would also break the assertions in `tests/summarizer.test.js`.
  - Same reasoning as the Windows AI path above: too little hardware reach and too much added complexity for the app's needs. *(User decision, 2026-07-09.)*
