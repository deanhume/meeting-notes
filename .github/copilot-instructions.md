# Copilot Instructions — Meeting Notes

Electron desktop app for tracking meeting notes about people in your organization. File-based JSON storage, Node.js/Express backend, vanilla-JS frontend (no framework, no bundler). Can also run as a plain web server for UI development.

## Commands

```bash
npm start          # Launch the Electron app (alias: npm run dev)
npm run web        # Run as a standalone Express server at http://localhost:3000
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
- `preload.js` is the IPC bridge; the renderer runs with `nodeIntegration: false` and `contextIsolation: true`, so only explicitly exposed APIs reach the frontend.
- `public/js/app.js` is all frontend logic (DOM manipulation, `fetch` calls, theme, modals). `public/css/style.css` holds theming via CSS custom properties.

When changing API behavior, edit `shared.js` once — both Electron and web mode inherit it. Tests in `tests/api.test.js` exercise `createApiRoutes` against a temp `dataDir`, so no Electron is needed to test the API.

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
- **No async/await** in the persistence layer — file I/O is synchronous by design.
- **Frontend**: vanilla JS only; modal-based create/edit; toggle visibility with the `hidden` class; persist UI prefs (theme) in `localStorage`; notes shown newest-first; autosave fires every 20 keystrokes.

## Adding an endpoint

Add the route inside `createApiRoutes` in `shared.js`: load with `safeLoadJSON`, validate input, mutate, persist with `atomicWriteFile`, return the right status + JSON. Add a matching test in `tests/api.test.js`.

## Docs

See `docs/` for deeper guides: `DEVELOPMENT.md`, `BUILDING.md`, `USAGE.md`, `AUTO_UPDATES.md`, `RELEASE_CHECKLIST.md`. Note `package.json` currently only defines Windows build scripts despite mac references in some docs.
