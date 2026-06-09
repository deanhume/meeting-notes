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
| `npm run web` | Run as standalone web server (testing only) |
| `npm run build` | Build Windows installer with auto-updates |
| `npm run build:dir` | Build Windows to directory without installer |
| `npm run build:mac` | Build macOS installers (DMG and ZIP) with auto-updates |
| `npm run build:mac:dir` | Build macOS to directory without installer |
| `npm run build:all` | Build for both Windows and macOS with auto-updates |
