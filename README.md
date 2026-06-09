# Meeting Notes

A desktop application for tracking meeting notes with individuals. Built with Electron.js and Express.

![Meeting Notes](public/images/logo-256.png)

## Features

- 📝 Track meeting notes for multiple people
- 👥 Manage contacts with names, roles, and teams
- 🔍 Search and filter through people
- 🏷️ Tag notes with topics (e.g., "hiring", "architecture", "follow-up") and filter by tag
- 💾 Local data storage - your data stays on your machine
- ⚙️ Customizable data storage location
- 🎨 Clean, minimalist interface with light/dark theme toggle
- 📋 Pre-configured discussion questions for meetings
- ✏️ Rich text editing for notes
- ✍️ Markdown support with live preview and formatting toolbar
- 💾 Autosave functionality - notes automatically save every 20 keystrokes when editing
- 🌐 Works completely offline with embedded fonts
- 🔄 Automatic software updates via GitHub Releases
- 📄 Marketing landing page included

## Tech Stack

- **Electron.js** - Desktop application framework
- **electron-updater** - Automatic software updates
- **Express.js** - Backend server for API
- **Vanilla JavaScript** - Frontend UI
- **JSON** - Data storage

## Prerequisites

- Node.js (v18 or higher)
- npm (comes with Node.js)

## Installation

### For End Users

**Windows:**
1. Download the latest `Meeting Notes Setup x.x.x.exe` from the releases
2. Run the installer
3. Follow the installation wizard
4. Launch "Meeting Notes" from your desktop or start menu
5. **Automatic updates** - The app will check for updates automatically and notify you when new versions are available

**macOS:**
1. Download the latest `Meeting Notes-x.x.x.dmg` or `.zip` from the releases
2. Open the DMG file and drag "Meeting Notes" to Applications (or unzip the .zip file)
3. Launch "Meeting Notes" from Applications
4. If you see a security warning, go to System Preferences → Security & Privacy and click "Open Anyway"
5. **Automatic updates** - The app will check for updates automatically and notify you when new versions are available

### For Developers

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/meeting-notes.git
   cd meeting-notes
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Development

### Running in Development Mode

Start the Electron app:
```bash
npm start
```

Or run as a web application (for testing the UI):
```bash
npm run web
```
Then open `http://localhost:3000` in your browser.

### Project Structure

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

### Key Files

- **main.js**: Electron main process that creates the window and manages the Express server
- **preload.js**: Secure bridge between Electron and the renderer process (for folder picker)
- **server.js**: Standalone Express server for web mode
- **shared.js**: Shared module containing validation, helpers, and API route factory used by both Electron and web server
- **public/js/app.js**: All frontend logic including API calls, UI interactions, and theme management
- **public/css/style.css**: Complete styling for the application including light/dark theme support

### Data Storage

The application stores data in JSON files:

**Electron App:**
- Settings: `%APPDATA%\meeting-notes\settings.json`
- Data: Configurable location (default: `%APPDATA%\meeting-notes\data\`)
  - `people.json` - List of contacts
  - `questions.json` - Discussion questions
  - `notes_[personId].json` - Notes for each person

**Web Mode:**
- Data: Configurable location specified in `server.js`

### API Endpoints

#### People
- `GET /api/people` - Get all people
- `POST /api/people` - Add a new person
- `PUT /api/people/:id` - Update a person
- `DELETE /api/people/:id` - Delete a person

#### Notes
- `GET /api/people/:id/notes` - Get notes for a person
- `POST /api/people/:id/notes` - Add a note
- `PUT /api/people/:id/notes/:noteId` - Update a note
- `DELETE /api/people/:id/notes/:noteId` - Delete a note

#### Questions
- `GET /api/questions` - Get all questions
- `PUT /api/questions` - Update questions

#### Tags
- `GET /api/tags` - Get all unique tags used across all notes

#### Settings
- `GET /api/settings` - Get current settings
- `PUT /api/settings/data-location` - Update data storage location

## Building for Distribution

### Build Windows Installer

To create a Windows installer (.exe):

```bash
npm run build
```

This will create:
- `dist/Meeting Notes Setup x.x.x.exe` - NSIS installer
- `dist/latest.yml` - **Required for auto-updates** - upload this to GitHub Releases
- `dist/win-unpacked/` - Unpacked application files

### Build to Directory Only (for testing)

```bash
npm run build:dir
```

This creates an unpacked version without the installer for quick testing.

### Build Configuration

The build configuration is in `package.json` under the `build` key. It includes settings for both Windows and macOS builds, including icon configuration, installers, and platform-specific options. The `publish` section enables automatic updates via GitHub Releases.

## Auto-Updates

Meeting Notes uses **electron-updater** to provide seamless automatic updates via GitHub Releases.

### How It Works

1. **Automatic Checking** - App checks for updates every hour and 3 seconds after startup
2. **User Choice** - When an update is available, users see a friendly dialog asking if they want to download
3. **Background Download** - Updates download while the app continues running
4. **Easy Installation** - After download, users can restart immediately or later to install

### User Experience

- **Non-intrusive** - Users are never forced to update
- **No interruptions** - If there's no update, users see nothing
- **Transparent** - Clear dialogs explain what's happening
- **Automatic on quit** - Updates install automatically when the app closes (if downloaded)

### Publishing Updates

To release a new version that users will automatically receive:

1. **Build your app:**
   ```bash
   npm run build        # Windows
   npm run build:mac    # macOS
   npm run build:all    # Both platforms
   ```

2. **Find the generated files in `dist/` folder:**
   - **Windows:** `Meeting Notes Setup x.x.x.exe` + `latest.yml`
   - **macOS:** `Meeting Notes-x.x.x.dmg` + `Meeting Notes-x.x.x-mac.zip` + `latest-mac.yml`

3. **Create a GitHub Release:**
   - Go to https://github.com/deanhume/meeting-notes/releases/new
   - Create a tag (e.g., `v1.1.8`) - version must be higher than current
   - Add release title and notes
   - **Upload ALL files** including the `.yml` files (critical for auto-updates!)
   - Publish the release

4. **Users get notified automatically** within an hour (or next time they start the app)

### Critical Files

The `.yml` files are **required** for auto-updates to work:
- `latest.yml` - Generated automatically by electron-builder for Windows
- `latest-mac.yml` - Generated automatically by electron-builder for macOS

**Without these files, auto-updates will not work!**

### Documentation

- **[AUTO_UPDATES.md](AUTO_UPDATES.md)** - Complete guide with testing, troubleshooting, and advanced configuration
- **[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)** - Quick reference for publishing updates

### Technical Details

- Uses `electron-updater` (modern replacement for Squirrel)
- Updates are downloaded via HTTPS from GitHub Releases
- Logs are stored at:
  - Windows: `%APPDATA%\meeting-notes\logs\main.log`
  - macOS: `~/Library/Logs/meeting-notes/main.log`
- Auto-updates only work in packaged builds (not during `npm start`)

### Configuration

The update configuration in `package.json`:
```json
{
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "deanhume",
        "repo": "meeting-notes"
      }
    ]
  }
}
```

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

## Settings

Access settings via the gear icon (⚙) in the sidebar.

### Data Storage Location

You can customize where your data is stored:

1. Click the settings icon
2. Click "Browse..." to select a folder
3. Click "Save & Reload"

The app will restart and use the new location for all data files.

### Theme

Toggle between light and dark themes using the theme toggle button at the bottom of the sidebar. Your preference is automatically saved.

## Keyboard Shortcuts

- `Escape` - Close any open modal
- `Ctrl/Cmd + Enter` - Save in modals (notes, people, questions)

## Troubleshooting

### App won't start
- Check if port 3000 is already in use
- Try deleting `node_modules` and running `npm install` again

### Data not saving
- Check the data location in Settings
- Ensure you have write permissions to the data directory
- Check the console for error messages

### Build fails
- Ensure you have the latest version of Node.js
- Delete `node_modules`, `package-lock.json`, and `dist` folder
- Run `npm install` and try building again
- Make sure your logo is at least 256x256 pixels

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Author

Dean Hume

## Version History

### 1.1.7 (2026-06-09)
- Added Markdown support with live preview - notes render headings, bold, italic, lists, code blocks, links, and more
- Added formatting toolbar (bold, italic, heading, lists, code, link, checkbox) for easy markdown without memorizing syntax
- Keyboard shortcuts: Ctrl+B for bold, Ctrl+I for italic
- Write/Preview tab toggle in the note editor

### 1.1.0 (2026-05-20)
- Added autosave functionality - notes automatically save every 20 keystrokes when editing
- Visual autosave indicator displays "Autosaved recently" above textarea
- Autosave indicator auto-hides after 3 seconds

### 1.0.0 (2026-05-19)
- Initial release
- Core features: people management, note taking, questions, tagging
- Settings for customizable data location
- Windows installer with custom branding
- Clean, minimalist UI with light/dark theme toggle
- Completely offline with embedded fonts
- Marketing landing page
- Enhanced security with input validation and atomic file writes
- Refactored architecture with shared module for code reuse

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Built with ❤️ using Electron.js**
