const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
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
function atomicWriteFile(filePath, content) {
  const tempFile = `${filePath}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, content, 'utf8');
    fs.renameSync(tempFile, filePath);
  } catch (err) {
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (e) {}
    }
    throw err;
  }
}

function validateId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[a-z0-9]{8,20}$/.test(id);
}

function safeLoadJSON(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error loading ${filePath}:`, err.message);
  }
  return defaultValue;
}

function validateInput(value, maxLength = 10000) {
  if (typeof value !== 'string') return false;
  if (value.length > maxLength) return false;
  return true;
}

function loadPeople() {
  return safeLoadJSON(PEOPLE_FILE, []);
}

function savePeople(people) {
  atomicWriteFile(PEOPLE_FILE, JSON.stringify(people, null, 2));
}

function getNotesFile(personId) {
  if (!validateId(personId)) {
    throw new Error('Invalid person ID');
  }
  return path.join(DATA_DIR, `notes_${personId}.json`);
}

function loadNotes(personId) {
  if (!validateId(personId)) return [];
  const file = getNotesFile(personId);
  return safeLoadJSON(file, []);
}

function saveNotes(personId, notes) {
  if (!validateId(personId)) {
    throw new Error('Invalid person ID');
  }
  atomicWriteFile(getNotesFile(personId), JSON.stringify(notes, null, 2));
}

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

function loadQuestions() {
  return safeLoadJSON(QUESTIONS_FILE, defaultQuestions);
}

function saveQuestions(questions) {
  atomicWriteFile(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
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
  if (!validateInput(name, 200) || !validateInput(role, 200) || !validateInput(team, 200)) {
    return res.status(400).json({ error: 'Invalid input length' });
  }

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
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

  const people = loadPeople();
  const idx = people.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Person not found' });

  const { name, role, team } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!validateInput(name, 200) || !validateInput(role, 200) || !validateInput(team, 200)) {
    return res.status(400).json({ error: 'Invalid input length' });
  }

  people[idx] = { ...people[idx], name: name.trim(), role: (role || '').trim(), team: (team || '').trim() };
  savePeople(people);
  res.json(people[idx]);
});

// DELETE person (and their notes)
app.delete('/api/people/:id', (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

  const people = loadPeople();
  const idx = people.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Person not found' });

  people.splice(idx, 1);
  savePeople(people);

  try {
    const notesFile = getNotesFile(req.params.id);
    if (fs.existsSync(notesFile)) fs.unlinkSync(notesFile);
  } catch (err) {
    console.error('Error deleting notes file:', err.message);
  }

  res.json({ ok: true });
});

// ── Notes API ───────────────────────────────────────────────

// GET notes for a person
app.get('/api/people/:id/notes', (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

  const people = loadPeople();
  if (!people.find(p => p.id === req.params.id)) return res.status(404).json({ error: 'Person not found' });
  const notes = loadNotes(req.params.id);
  res.json(notes.slice().reverse()); // newest first
});

// POST add note
app.post('/api/people/:id/notes', (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

  const people = loadPeople();
  if (!people.find(p => p.id === req.params.id)) return res.status(404).json({ error: 'Person not found' });

  const { content, title } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });
  if (!validateInput(content, 50000) || !validateInput(title, 500)) {
    return res.status(400).json({ error: 'Input too long' });
  }

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
  if (!validateId(req.params.id) || !validateId(req.params.noteId)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const notes = loadNotes(req.params.id);
  const idx = notes.findIndex(n => n.id === req.params.noteId);
  if (idx === -1) return res.status(404).json({ error: 'Note not found' });

  const { content, title } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });
  if (!validateInput(content, 50000) || !validateInput(title, 500)) {
    return res.status(400).json({ error: 'Input too long' });
  }

  notes[idx] = { ...notes[idx], title: (title || '').trim(), content: content.trim(), updatedAt: new Date().toISOString() };
  saveNotes(req.params.id, notes);
  res.json(notes[idx]);
});

// DELETE note
app.delete('/api/people/:id/notes/:noteId', (req, res) => {
  if (!validateId(req.params.id) || !validateId(req.params.noteId)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

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
  if (questions.length > 500) return res.status(400).json({ error: 'Too many questions' });
  
  const cleaned = questions
    .filter(q => validateInput(q, 1000))
    .map(q => (q || '').trim())
    .filter(q => q.length > 0);
  
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
