# Meeting Notes

A desktop app for tracking meeting notes with individuals. Built with Electron.js and Express.

![Meeting Notes](public/images/logo-256.png)

## Features

- 📝 Track meeting notes for multiple people
- 👥 Manage contacts with names, roles, and teams
- 🏷️ Tag and filter notes by topic
- ✍️ Markdown support with live preview
- 💾 Autosave & local-only data storage
- 🎨 Light/dark theme
- 🔄 Automatic updates via GitHub Releases
- 🌐 Works completely offline

## Quick Start

### Install (End Users)

Download the latest release from the [Releases page](https://github.com/deanhume/meeting-notes/releases):

- **Windows** — run `Meeting Notes Setup x.x.x.exe`
- **macOS** — open the `.dmg` and drag to Applications

Updates are delivered automatically after install.

### Develop

```bash
git clone https://github.com/deanhume/meeting-notes.git
cd meeting-notes
npm install
npm start
```

## Documentation

| Topic | Description |
|-------|-------------|
| [Development Guide](docs/DEVELOPMENT.md) | Project structure, API endpoints, scripts, data storage |
| [Building & Distribution](docs/BUILDING.md) | Creating installers, build config |
| [Usage & Troubleshooting](docs/USAGE.md) | Settings, keyboard shortcuts, common issues |
| [Auto-Updates](AUTO_UPDATES.md) | How updates work, testing, troubleshooting |
| [Release Checklist](RELEASE_CHECKLIST.md) | Step-by-step guide for publishing new versions |

## Tech Stack

Electron.js · Express.js · Vanilla JS · JSON storage · electron-updater

## Version History

### 1.1.7 (2026-06-09)
- Markdown support with live preview and formatting toolbar

### 1.1.0 (2026-05-20)
- Autosave functionality

### 1.0.0 (2026-05-19)
- Initial release

## License

MIT — Dean Hume

---

**Built with ❤️ using Electron.js**
