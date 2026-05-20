# GitHub Copilot Instructions - Meeting Notes App

## Project Overview

This is an Electron desktop application for tracking meeting notes with people in your organization. It's a file-based system using Node.js/Express backend with vanilla JavaScript frontend. The app can also run in web-only mode for development.

## Tech Stack

- **Desktop Framework**: Electron.js (v42.0.1)
- **Backend**: Node.js with Express.js (v4.18.2)
- **Frontend**: Vanilla JavaScript, HTML, CSS (no frameworks)
- **Data Storage**: JSON files with atomic writes for safety
- **Fonts**: Self-hosted IBM Plex Sans, IBM Plex Mono, and Playfair Display for offline use
- **Build**: electron-builder for Windows installers

## Architecture

### Backend (main.js + shared.js)
- Electron main process creates BrowserWindow and embedded Express server
- RESTful API factory in shared.js used by both Electron and standalone server
- Atomic file writes using temp files to prevent data corruption
- Two main entity types: People and Notes
- Notes are stored per person in separate JSON files (`notes_<personId>.json`)
- ID generation using crypto.randomBytes for security
- Settings stored in Electron userData directory (`%APPDATA%/meeting-notes/`)

### Frontend (public/)
- Single-page application with modal-based interactions
- No build process or bundling
- Direct DOM manipulation (no virtual DOM)
- Responsive design with sidebar navigation
- Light/dark theme toggle with localStorage persistence
- Self-hosted fonts for complete offline functionality

### Data Structure
- `data/people.json` - Array of person objects
- `data/questions.json` - Array of question objects
- `data/notes_<id>.json` - Array of note objects per person
- `settings.json` - User settings (data location, theme preference)
- Person: `{id, name, role, team, createdAt}`
- Note: `{id, title, content, tags, createdAt, updatedAt}`
- Tags: Array of lowercase strings (max 20 per note, each ≤50 chars)

## Coding Conventions

### JavaScript Style
- Use `const` and `let` (no `var`)
- Arrow functions for callbacks
- Destructuring for request bodies
- Template literals for strings
- Synchronous file operations with atomic writes (no async/await currently used)
- Modular code with shared utilities in shared.js

### API Patterns
- RESTful endpoints: `/api/people` and `/api/people/:id/notes`
- Status codes: 200/201 for success, 400 for validation, 404 for not found
- JSON request/response bodies
- Validation: return 400 with error message for invalid input
- Always trim whitespace from user inputs

### Error Handling
- Return appropriate HTTP status codes
- Provide descriptive error messages in JSON: `{error: "message"}`
- Check for existence before operations (people/notes)

### Frontend Patterns
- Modal-based UI for create/edit operations
- Use `hidden` class for visibility toggling
- Event listeners on specific IDs
- Fetch API for HTTP requests
- Display relative timestamps ("2h ago")
- Theme persistence via localStorage
- CSS custom properties for theme variables

## File Organization

```
meeting-notes/
├── main.js            # Electron main process
├── preload.js         # Electron preload script (IPC bridge)
├── server.js          # Standalone Express server for web mode
├── shared.js          # Shared validation, helpers, and API routes
├── package.json       # Dependencies & scripts
├── data/              # JSON data storage (user-configurable location)
│   ├── people.json    # All people
│   ├── questions.json # Discussion questions
│   └── notes_*.json   # Notes per person
├── public/            # Static frontend files
│   ├── index.html     # Main HTML structure
│   ├── css/           # Styles
│   │   ├── style.css  # Application styles with theme support
│   │   └── fonts.css  # Font definitions
│   ├── js/            # Frontend JavaScript
│   │   └── app.js     # All client-side logic
│   ├── fonts/         # Self-hosted fonts for offline use
│   └── images/        # Logo and icons
├── marketing/
│   └── index.html     # Marketing landing page
└── dist/              # Build output (generated)
```

## Key Features to Maintain

1. **Sidebar search/filter** for people
2. **Relative timestamps** with full timestamp on hover
3. **Keyboard shortcuts**: Esc to close modals, Ctrl+Enter to save
4. **Cascading deletes**: Delete person removes their notes file
5. **Newest first**: Notes displayed in reverse chronological order
6. **Avatar generation**: Person avatars use initials
7. **Note tagging**: Notes can be tagged; tags are filterable per person and auto-suggested from previously used tags
8. **Tag API**: `GET /api/tags` returns all unique tags across all notes
9. **Light/dark theme**: Toggle in sidebar, preference saved to localStorage
10. **Atomic file writes**: Use temp file + rename to prevent data corruption
11. **Settings management**: Configurable data location via Electron userData
12. **Offline fonts**: Self-hosted fonts for complete offline functionality
13. **Autosave**: Notes automatically save every 20 keystrokes when editing; visual indicator appears and auto-hides after 3 seconds

## Guidelines for Copilot

### When Adding Features
- Keep the simplicity: no databases, no external dependencies unless necessary
- Maintain file-based storage approach
- Follow existing API patterns and status codes
- Update README.md if adding user-facing features

### When Modifying Backend
- Use atomic file writes (atomicWriteFile) for all data persistence
- Validate all user inputs using shared validation functions
- Ensure data directory and files exist before operations
- Use helper functions from shared.js (safeLoadJSON, sanitizeString, etc.)
- Keep API route factory pattern in shared.js for code reuse

### When Modifying Frontend
- No frameworks - use vanilla JavaScript
- Keep modal-based interaction pattern
- Maintain existing keyboard shortcuts
- Preserve responsive design
- Use CSS custom properties for themeable values
- Store UI preferences in localStorage

### When Fixing Bugs
- Check file existence before read/write operations
- Validate JSON parsing with try-catch if needed
- Ensure proper cleanup (e.g., delete note files when deleting person)

### Code Quality
- Keep functions small and focused
- Use descriptive variable names
- Minimal comments - code should be self-documenting
- Follow existing formatting and indentation

## Common Tasks

### Adding a New API Endpoint
1. Define route with appropriate HTTP method
2. Load data using helper functions
3. Validate input
4. Perform operation
5. Save data using helper functions
6. Return appropriate status and JSON response

### Adding a New Modal
1. Add HTML structure to index.html
2. Add corresponding CSS styles
3. Add event listeners in JavaScript
4. Handle form submission and validation
5. Update UI after successful operation

### Data Migration
- If changing data structure, provide migration script
- Maintain backwards compatibility where possible
- Update both read and write operations

## Testing Considerations

- Test with empty data directory
- Test with missing people.json file
- Test concurrent operations (file locking not implemented)
- Test input validation (empty strings, special characters)
- Test deletion cascades properly

## Performance Notes

- Synchronous file I/O is acceptable for local use
- No pagination implemented (may be needed for large datasets)
- No caching layer (reads/writes directly to files)

## Security Considerations

- **Enhanced input validation**: All inputs sanitized and validated on both client and server
- **Atomic file writes**: Temp file + rename pattern prevents data corruption
- **Context isolation**: Electron runs with nodeIntegration disabled and contextIsolation enabled
- **IPC security**: Preload script exposes only specific, safe APIs to renderer
- **Crypto-based IDs**: Uses crypto.randomBytes instead of predictable timestamps
- **No external CDNs**: All fonts and assets self-hosted for privacy and offline use
- **Local-only by default**: Designed for single-user local use
- No authentication/authorization (not designed for multi-user deployment)
- File system access restricted to configured data directory
