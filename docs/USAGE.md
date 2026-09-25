# Usage Guide

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
- `Ctrl + B` - Bold (in note editor)
- `Ctrl + I` - Italic (in note editor)

## Recording Summaries

In the desktop app, stopping a recording produces an on-device, extractive
summary. It separates discussion highlights, decisions, actions, tentative
proposals and open questions. It uses selected source wording and a small set of
guarded shortening templates, not a language model.

- **Full highlights** selects up to 20 optional facts within a shared
  360-word target. Selection balances risks, status, constraints, alternatives
  and follow-ups instead of repeatedly selecting a project's introduction.
  Related points are grouped under phrases found in the transcript.
  Explicit `Topic: Migration` or `Agenda item: Hiring` headings are honoured.
- **Brief highlights** uses up to seven optional passages and a 220-word target.
  Both modes retain recognised actions, decisions and dated visit arrangements;
  these can exceed the target. Proposals and open questions compete with other
  highlights for space. Neither mode guarantees that every real commitment was
  recognised. Headings and supporting passages are outside the word target.
- **Include supporting transcript passages** adds source references such as
  `[S12]` and the original passages to the note. These are saved as ordinary
  Markdown, so they remain available when the note is reopened or exported.
- **Regenerate summary** applies changed options to the most recent transcript
  in the current editor session. An untouched generated block is replaced;
  if you edited that block, a fresh one is appended without overwriting your work.
  Closing or switching notes clears this temporary regeneration cache.

Source IDs are assigned before filtering and remain stable when complete
segments are appended to the same transcript. IDs are local to that transcript,
not global identifiers. Original stored transcript files are not rewritten.
Choosing a shorter summary does not truncate the transcript.

Review names, dates, negations and correction exchanges before relying on the
notes. Owner and due-date fields are extracted only when explicitly recognised;
**not specified** means the extractor could not safely populate the field, not
necessarily that nobody said it. An unlabelled "I'll" is not assigned to a person.
Explicit corrections retain both statements for review rather than inventing a
new final sentence. Personal context is no longer discarded simply because it
mentions holidays, summer, coffee or similar words.

Vague follow-ups get a nearby object or topic only when the source supports the
connection. Otherwise **Object not specified** remains visible. A request to
share findings is labelled **not confirmed**, not silently turned into a new
commitment. Mentioning a contact does not assign that person an action.

The summariser reconnects some speech-to-text fragments and removes limited
verbal repetition, while retaining original passages as evidence. It cannot
reliably repair misheard names, resolve ambiguous dates or supply a missing
subject. Incomplete names/plans are labelled for review. Visit arrangements use
compact fields for the mentioned date, raw time, transport and corrections,
with the original exchange retained in the supporting passages. A recorded
`1030` is not silently converted to `10:30am`; conditional travel and conflicting
dates remain flagged. Inferred topic labels are navigational hints, not verified
attribution of every nearby remark.

If a generated note exceeds the existing 50,000-character limit, the app keeps
your existing note and transcript and reports the problem. Choose brief
highlights or omit supporting passages, then regenerate; unusually large action
lists may still need manual editing. Older saved notes are not automatically
rewritten. Recording still requires the bundled speech-to-text model; these
summary improvements require no additional model, dependency or download.

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
