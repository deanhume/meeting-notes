const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = 'C:\\Users\\deanhume\\OneDrive - Microsoft\\Meeting-notes-tool\\data';
const PEOPLE_FILE = path.join(DATA_DIR, 'people.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PEOPLE_FILE)) fs.writeFileSync(PEOPLE_FILE, JSON.stringify([]));

// Default questions
const defaultQuestions = [
  "What are the biggest technical challenges your teams are facing right now?",
  "How are you balancing technical debt with new feature development?",
  "What's your current perspective on our architecture and tech stack?",
  "Are there any areas where you feel the engineering organization is falling behind?",
  "What technical investments should we be prioritizing in the next quarter?",
  "How are your teams handling production incidents and system reliability?",
  "What concerns do you have about our current technical direction?",
  "Are there any skill gaps or hiring needs in your organization?",
  "How effective is cross-team collaboration and knowledge sharing?",
  "What technical standards or practices should we be implementing?",
  "Are there any bottlenecks in your development processes?",
  "How are you approaching AI/ML integration in your products?",
  "What's your assessment of our security posture and practices?",
  "Are the tools and infrastructure supporting your teams effectively?",
  "What emerging technologies should we be paying attention to?",
  "How are you managing technical risk across your portfolio?",
  "What feedback are you hearing from your engineering leads?",
  "Are there any organizational changes that would improve delivery?",
  "What technical metrics are you most focused on right now?",
  "How can I better support you and your leadership team?"
];
if (!fs.existsSync(QUESTIONS_FILE)) fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(defaultQuestions, null, 2));

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

function loadQuestions() {
  return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
}

function saveQuestions(questions) {
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
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

// ── Questions API ───────────────────────────────────────────

// GET all questions
app.get('/api/questions', (req, res) => {
  res.json(loadQuestions());
});

// PUT update all questions
app.put('/api/questions', (req, res) => {
  const { questions } = req.body;
  if (!Array.isArray(questions)) return res.status(400).json({ error: 'Questions must be an array' });
  
  const cleaned = questions.map(q => (q || '').trim()).filter(q => q.length > 0);
  if (cleaned.length === 0) return res.status(400).json({ error: 'At least one question is required' });
  
  saveQuestions(cleaned);
  res.json(cleaned);
});

// ── Catch-all ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n📋 Meeting Notes running at http://localhost:${PORT}\n`);
});
