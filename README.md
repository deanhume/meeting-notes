[![Tests](https://github.com/deanhume/meeting-notes/actions/workflows/test.yml/badge.svg)](https://github.com/deanhume/meeting-notes/actions/workflows/test.yml)

<img src="public/images/logo-256.png" alt="drawing" width="150"/>

# Meeting Notes
A lightweight, local-first desktop app for keeping organised meeting notes with the people you work with. Track every 1:1 and team conversation by person, write in Markdown with live preview, tag and filter notes by topic, and even record meetings to transcribe and summarise them into bullet points — all on-device. Your data never leaves your machine: no cloud, no accounts, and it works completely offline. Built with Electron.js and Express.

## Features

- 📝 Track meeting notes for multiple people
- 👥 Manage contacts with names, roles, and teams
- 🏷️ Tag and filter notes by topic
- ✍️ Markdown support with live preview
- 🎙️ Voice recording with offline speech-to-text (mic and/or system audio)
- 💾 Autosave & local-only data storage
- 🎨 Light/dark theme
- 🔄 Automatic updates via GitHub Releases
- 🌐 Works completely offline

## Quick Start

### Install (End Users)

Download the latest release from the [Releases page](https://github.com/deanhume/meeting-notes/releases):

- **Windows** — run `Meeting Notes Setup x.x.x.exe`

Updates are delivered automatically after install.

### Develop

```bash
git clone https://github.com/deanhume/meeting-notes.git
cd meeting-notes
npm install
npm run fetch-model   # downloads the local speech-to-text model (~140 MB)
npm start
```

> The Whisper model (`models/ggml-base.bin`) powers offline voice transcription. It is
> not committed to git; `npm run fetch-model` downloads it. The Record button is hidden
> until the model is present.

## Documentation

| Topic | Description |
|-------|-------------|
| [Development Guide](docs/DEVELOPMENT.md) | Project structure, API endpoints, scripts, data storage |
| [Building & Distribution](docs/BUILDING.md) | Creating installers, build config |
| [Usage & Troubleshooting](docs/USAGE.md) | Settings, keyboard shortcuts, common issues |
| [Auto-Updates](docs/AUTO_UPDATES.md) | How updates work, testing, troubleshooting |
| [Release Checklist](docs/RELEASE_CHECKLIST.md) | Step-by-step guide for publishing new versions |

## Tech Stack

Electron.js · Express.js · Vanilla JS · JSON storage · electron-updater

## Version History

### 1.2.0 (2026-06-23)
- Voice recording with offline speech-to-text — record mic and/or system audio and transcribe directly into notes

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
