const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const express = require('express');
const fs = require('fs');

let mainWindow;
let server;
const PORT = 3000;
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
  return { dataLocation: path.join(app.getPath('userData'), 'data') };
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'public', 'images', 'logo-256.png'),
    autoHideMenuBar: true
  });

  Menu.setApplicationMenu(null);

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startServer() {
  const expressApp = express();
  const settings = loadSettings();
  let DATA_DIR = settings.dataLocation;
  let PEOPLE_FILE = path.join(DATA_DIR, 'people.json');
  let QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');

  expressApp.use(express.json());
  expressApp.use(express.static(path.join(__dirname, 'public')));

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
  expressApp.get('/api/people', (req, res) => {
    res.json(loadPeople());
  });

  // POST add person
  expressApp.post('/api/people', (req, res) => {
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
  expressApp.put('/api/people/:id', (req, res) => {
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
  expressApp.delete('/api/people/:id', (req, res) => {
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
  expressApp.get('/api/people/:id/notes', (req, res) => {
    const people = loadPeople();
    if (!people.find(p => p.id === req.params.id)) return res.status(404).json({ error: 'Person not found' });
    const notes = loadNotes(req.params.id);
    res.json(notes.slice().reverse()); // newest first
  });

  // POST add note
  expressApp.post('/api/people/:id/notes', (req, res) => {
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
  expressApp.put('/api/people/:id/notes/:noteId', (req, res) => {
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
  expressApp.delete('/api/people/:id/notes/:noteId', (req, res) => {
    const notes = loadNotes(req.params.id);
    const idx = notes.findIndex(n => n.id === req.params.noteId);
    if (idx === -1) return res.status(404).json({ error: 'Note not found' });

    notes.splice(idx, 1);
    saveNotes(req.params.id, notes);
    res.json({ ok: true });
  });

  // ── Questions API ───────────────────────────────────────────

  // GET all questions
  expressApp.get('/api/questions', (req, res) => {
    res.json(loadQuestions());
  });

  // PUT update all questions
  expressApp.put('/api/questions', (req, res) => {
    const { questions } = req.body;
    if (!Array.isArray(questions)) return res.status(400).json({ error: 'Questions must be an array' });
    
    const cleaned = questions.map(q => (q || '').trim()).filter(q => q.length > 0);
    if (cleaned.length === 0) return res.status(400).json({ error: 'At least one question is required' });
    
    saveQuestions(cleaned);
    res.json(cleaned);
  });

  // ── Settings API ───────────────────────────────────────────

  // GET settings
  expressApp.get('/api/settings', (req, res) => {
    res.json(loadSettings());
  });

  // PUT update data location
  expressApp.put('/api/settings/data-location', (req, res) => {
    const { dataLocation } = req.body;
    if (!dataLocation || !dataLocation.trim()) {
      return res.status(400).json({ error: 'Data location is required' });
    }

    const newLocation = dataLocation.trim();
    
    // Validate the path exists or can be created
    try {
      if (!fs.existsSync(newLocation)) {
        fs.mkdirSync(newLocation, { recursive: true });
      }
      
      // Update the settings
      const settings = loadSettings();
      settings.dataLocation = newLocation;
      saveSettings(settings);

      // Update server paths
      DATA_DIR = newLocation;
      PEOPLE_FILE = path.join(DATA_DIR, 'people.json');
      QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');

      // Ensure files exist in new location
      if (!fs.existsSync(PEOPLE_FILE)) fs.writeFileSync(PEOPLE_FILE, JSON.stringify([]));
      if (!fs.existsSync(QUESTIONS_FILE)) fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(defaultQuestions, null, 2));

      res.json({ success: true, dataLocation: newLocation });
    } catch (err) {
      res.status(400).json({ error: 'Invalid data location: ' + err.message });
    }
  });

  // ── Catch-all ───────────────────────────────────────────────
  expressApp.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  server = expressApp.listen(PORT, () => {
    console.log(`Meeting Notes server running at http://localhost:${PORT}`);
    console.log(`Data stored in: ${DATA_DIR}`);
  });
}

// IPC handlers for folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', function () {
    if (mainWindow === null) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') app.quit();
});
