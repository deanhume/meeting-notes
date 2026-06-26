# Copilot Instructions — Meeting Notes

Electron desktop app for tracking meeting notes about people in your organization. File-based JSON storage, Node.js/Express backend, vanilla-JS frontend (no framework, no bundler). Can also run as a plain web server for UI development.

## Commands

```bash
npm start          # Launch the Electron app (alias: npm run dev)
npm run web        # Run as a standalone Express server at http://localhost:3000
npm run fetch-model # Download the Whisper STT model (~140 MB) into models/
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
- `preload.js` is the IPC bridge; the renderer runs with `nodeIntegration: false` and `contextIsolation: true`, so only explicitly exposed APIs reach the frontend. It exposes exactly `window.electronAPI.{selectFolder, transcriptionAvailable, transcribeAudio}` via `contextBridge` — add any new renderer↔main capability here plus a matching `ipcMain.handle` in `main.js`.
- `transcription.js` (Electron main process only) wraps `smart-whisper` (whisper.cpp) for fully on-device speech-to-text. The Whisper model is loaded lazily on first use and kept resident. Voice/transcription is Electron-only — it is **not** available in web mode.
- `public/js/app.js` is all frontend logic (DOM manipulation, `fetch` calls, theme, modals). `public/css/style.css` holds theming via CSS custom properties.
- `public/js/summarizer.js` turns a raw transcript into bullet points using a fully on-device **extractive** algorithm (sentence cleanup + TextRank-style similarity scoring + signal boosting) — no LLM, no network. It is a **dual-mode module**: it attaches to `window` for the browser and also `module.exports` its functions (guarded by `typeof module !== 'undefined'`) so it can be unit-tested in Node without a browser. Keep this dual export when editing.

When changing API behavior, edit `shared.js` once — both Electron and web mode inherit it. Tests in `tests/api.test.js` exercise `createApiRoutes` against a temp `dataDir`, and `tests/shared.test.js` covers the helpers — so no Electron is needed to test the API or persistence layer. `tests/summarizer.test.js` and `tests/transcription.test.js` cover the summarization and transcription helpers directly via their CommonJS exports.

## Data model

JSON files in the configured data dir:

- `people.json` — array of `{id, name, role, team, createdAt}`
- `questions.json` — array of discussion questions
- `notes_<personId>.json` — array of `{id, title, content, tags, createdAt, updatedAt}` per person
- `settings.json` — data location + theme (Electron only)

Key API surface: `/api/people`, `/api/people/:id/notes`, `/api/questions`, `/api/tags`, `/api/settings`.

## Conventions

- **Atomic writes**: persist data with `atomicWriteFile` (temp file + rename). Never write a data file directly.
- **Reads**: use `safeLoadJSON(path, default)` — it tolerates missing/corrupt files.
- **IDs**: generate with `generateId()` (12-char hex via `crypto.randomBytes(6)`); validate with `validateId`.
- **Input**: sanitize/trim with `sanitizeString`; validate via the `validate*` helpers in `shared.js` before persisting. Tags are lowercase, max 20 per note, ≤50 chars each.
- **HTTP**: 200/201 success, 400 validation (`{ error: "message" }`), 404 not found.
- **Cascading delete**: deleting a person must remove their `notes_<id>.json` file.
- **No async/await** in the persistence layer — file I/O is synchronous by design. (Transcription in `transcription.js` is the exception: it is async because Whisper is.)
- **Voice transcription**: audio is captured in the renderer, downsampled to 16kHz mono Float32 PCM, and sent via `transcribeAudio` IPC; transcription runs on-device and never leaves the machine. The resulting transcript can be condensed into bullet points by `summarizeToBullets` in `public/js/summarizer.js` (also on-device). The Record button stays hidden until `transcriptionAvailable` reports the model (`models/ggml-base.bin`) is present.
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
