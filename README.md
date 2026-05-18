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
- 🎨 Clean, minimalist interface
- 📋 Pre-configured discussion questions for meetings
- ✏️ Rich text editing for notes

## Tech Stack

- **Electron.js** - Desktop application framework
- **Express.js** - Backend server for API
- **Vanilla JavaScript** - Frontend UI
- **JSON** - Data storage

## Prerequisites

- Node.js (v18 or higher)
- npm (comes with Node.js)

## Installation

### For End Users

1. Download the latest `Meeting Notes Setup 1.0.0.exe` from the releases
2. Run the installer
3. Follow the installation wizard
4. Launch "Meeting Notes" from your desktop or start menu

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
├── package.json         # Project dependencies and scripts
├── public/
│   ├── index.html       # Main HTML file
│   ├── css/
│   │   └── style.css    # Application styles
│   ├── js/
│   │   └── app.js       # Frontend JavaScript
│   └── images/
│       ├── logo.png     # Original logo (240x240)
│       └── logo-256.png # Resized logo for installer (256x256)
└── dist/                # Build output (generated)
```

### Key Files

- **main.js**: Electron main process that creates the window and manages the Express server
- **preload.js**: Secure bridge between Electron and the renderer process (for folder picker)
- **server.js**: Standalone Express server for web mode
- **public/js/app.js**: All frontend logic including API calls and UI interactions
- **public/css/style.css**: Complete styling for the application

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
- `dist/Meeting Notes Setup 1.0.0.exe` - NSIS installer
- `dist/win-unpacked/` - Unpacked application files

### Build to Directory Only (for testing)

```bash
npm run build:dir
```

This creates an unpacked version without the installer for quick testing.

### Build Configuration

The build configuration is in `package.json` under the `build` key:

```json
{
  "build": {
    "appId": "com.deanhume.meetingnotes",
    "productName": "Meeting Notes",
    "win": {
      "target": "nsis",
      "icon": "public/images/logo-256.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the Electron app |
| `npm run dev` | Start in development mode (same as start) |
| `npm run web` | Run as web server only |
| `npm run build` | Build Windows installer |
| `npm run build:dir` | Build to directory without installer |

## Settings

Access settings via the gear icon (⚙) in the sidebar.

### Data Storage Location

You can customize where your data is stored:

1. Click the settings icon
2. Click "Browse..." to select a folder
3. Click "Save & Reload"

The app will restart and use the new location for all data files.

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

### 1.0.0 (2026-05-14)
- Initial release
- Core features: people management, note taking, questions
- Settings for customizable data location
- Windows installer with custom branding
- Clean, minimalist UI

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Built with ❤️ using Electron.js**
