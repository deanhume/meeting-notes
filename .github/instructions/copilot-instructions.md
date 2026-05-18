# GitHub Copilot Instructions - Meeting Notes App

## Project Overview

This is a local web application for tracking meeting notes with people in your organization. It's a simple, file-based system using Node.js/Express backend with vanilla JavaScript frontend.

## Tech Stack

- **Backend**: Node.js with Express.js (v4.18.2)
- **Frontend**: Vanilla JavaScript, HTML, CSS (no frameworks)
- **Data Storage**: JSON files in the `data/` directory
- **Server**: Simple Express server on port 3000

## Architecture

### Backend (server.js)
- RESTful API with Express
- File-based storage using `fs` module synchronously
- Two main entity types: People and Notes
- Notes are stored per person in separate JSON files (`notes_<personId>.json`)
- ID generation using timestamp + random string

### Frontend (public/)
- Single-page application with modal-based interactions
- No build process or bundling
- Direct DOM manipulation (no virtual DOM)
- Responsive design with sidebar navigation

### Data Structure
- `data/people.json` - Array of person objects
- `data/notes_<id>.json` - Array of note objects per person
- Person: `{id, name, role, team, createdAt}`
- Note: `{id, title, content, tags, createdAt, updatedAt}`
- Tags: Array of lowercase strings (max 20 per note, each ≤50 chars)

## Coding Conventions

### JavaScript Style
- Use `const` and `let` (no `var`)
- Arrow functions for callbacks
- Destructuring for request bodies
- Template literals for strings
- Synchronous file operations (no async/await currently used)

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

## File Organization

```
meeting-notes/
├── server.js          # Express server & API endpoints
├── package.json       # Dependencies & scripts
├── data/              # JSON data storage
│   ├── people.json    # All people
│   └── notes_*.json   # Notes per person
└── public/            # Static frontend files
    ├── index.html     # Main HTML structure
    ├── css/           # Styles
    └── js/            # Frontend JavaScript
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

## Guidelines for Copilot

### When Adding Features
- Keep the simplicity: no databases, no external dependencies unless necessary
- Maintain file-based storage approach
- Follow existing API patterns and status codes
- Update README.md if adding user-facing features

### When Modifying Backend
- Keep synchronous file operations for consistency
- Validate all user inputs before processing
- Ensure data directory and files exist before operations
- Use helper functions like `loadPeople()`, `savePeople()`, etc.

### When Modifying Frontend
- No frameworks - use vanilla JavaScript
- Keep modal-based interaction pattern
- Maintain existing keyboard shortcuts
- Preserve responsive design

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

- This is a **local-only application** (not for production deployment)
- No authentication/authorization
- No input sanitization for XSS (would need if deployed)
- File system access is unrestricted within data directory
