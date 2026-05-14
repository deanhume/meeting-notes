const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PEOPLE_FILE = path.join(DATA_DIR, 'people.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PEOPLE_FILE)) fs.writeFileSync(PEOPLE_FILE, JSON.stringify([]));

// Helpers
function loadPeople() {
  return JSON.parse(fs.readFileSync(PEOPLE_FILE, 'utf8'));
}

function savePeople(people) {
  fs.writeFileSync(PEOPLE_FILE, JSON.stringify(people, null, 2));
}

function getNotesFile(personId) {
  return path.join(DATA_DIR, `notes_${personId}.json`);
}

function loadNotes(personId) {
  const file = getNotesFile(personId);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveNotes(personId, notes) {
  fs.writeFileSync(getNotesFile(personId), JSON.stringify(notes, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ── People API ──────────────────────────────────────────────

// GET all people
app.get('/api/people', (req, res) => {
  res.json(loadPeople());
});

// POST add person
app.post('/api/people', (req, res) => {
  const { name, role, team } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const people = loadPeople();
  const person = {
    id: generateId(),
    name: name.trim(),
    role: (role || '').trim(),
    team: (team || '').trim(),
    createdAt: new Date().toISOString()
  };
  people.push(person);
  savePeople(people);
  res.status(201).json(person);
});

// PUT update person
app.put('/api/people/:id', (req, res) => {
  const people = loadPeople();
  const idx = people.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Person not found' });

  const { name, role, team } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  people[idx] = { ...people[idx], name: name.trim(), role: (role || '').trim(), team: (team || '').trim() };
  savePeople(people);
  res.json(people[idx]);
});

// DELETE person (and their notes)
app.delete('/api/people/:id', (req, res) => {
  const people = loadPeople();
  const idx = people.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Person not found' });

  people.splice(idx, 1);
  savePeople(people);

  const notesFile = getNotesFile(req.params.id);
  if (fs.existsSync(notesFile)) fs.unlinkSync(notesFile);

  res.json({ ok: true });
});

// ── Notes API ───────────────────────────────────────────────

// GET notes for a person
app.get('/api/people/:id/notes', (req, res) => {
  const people = loadPeople();
  if (!people.find(p => p.id === req.params.id)) return res.status(404).json({ error: 'Person not found' });
  const notes = loadNotes(req.params.id);
  res.json(notes.slice().reverse()); // newest first
});

// POST add note
app.post('/api/people/:id/notes', (req, res) => {
  const people = loadPeople();
  if (!people.find(p => p.id === req.params.id)) return res.status(404).json({ error: 'Person not found' });

  const { content, title } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  const notes = loadNotes(req.params.id);
  const note = {
    id: generateId(),
    title: (title || '').trim(),
    content: content.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  notes.push(note);
  saveNotes(req.params.id, notes);
  res.status(201).json(note);
});

// PUT update note
app.put('/api/people/:id/notes/:noteId', (req, res) => {
  const notes = loadNotes(req.params.id);
  const idx = notes.findIndex(n => n.id === req.params.noteId);
  if (idx === -1) return res.status(404).json({ error: 'Note not found' });

  const { content, title } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  notes[idx] = { ...notes[idx], title: (title || '').trim(), content: content.trim(), updatedAt: new Date().toISOString() };
  saveNotes(req.params.id, notes);
  res.json(notes[idx]);
});

// DELETE note
app.delete('/api/people/:id/notes/:noteId', (req, res) => {
  const notes = loadNotes(req.params.id);
  const idx = notes.findIndex(n => n.id === req.params.noteId);
  if (idx === -1) return res.status(404).json({ error: 'Note not found' });

  notes.splice(idx, 1);
  saveNotes(req.params.id, notes);
  res.json({ ok: true });
});

// ── Catch-all ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n📋 Meeting Notes running at http://localhost:${PORT}\n`);
});
