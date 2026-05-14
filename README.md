# Meeting Notes

A local web app for tracking meeting notes with people in your organisation.

## Setup

1. **Install dependencies**
   ```bash
   cd meeting-notes
   npm install
   ```

2. **Start the server**
   ```bash
   npm start
   ```

3. **Open in browser**
   Visit [http://localhost:3000](http://localhost:3000)

## Features

- Add people (name, role, team)
- Record timestamped meeting notes per person
- Edit or delete notes and people
- Search/filter the people sidebar
- Notes show relative time ("2h ago") and full timestamp on hover
- Data stored locally as JSON files in the `data/` folder
- Keyboard shortcuts: `Esc` to close modals, `Ctrl+Enter` to save

## Data

All data is stored in the `data/` directory:
- `data/people.json` — list of people
- `data/notes_<id>.json` — notes for each person

Back up this folder to preserve your data.
