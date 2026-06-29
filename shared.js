/**
 * Shared module for Meeting Notes app.
 *
 * This is the single source of truth for:
 *   - Data persistence helpers (atomic writes, safe JSON loading)
 *   - Input validation and sanitization
 *   - The Express API route factory (`createApiRoutes`)
 *
 * Both the Electron main process (main.js) and the standalone web server
 * (server.js) import `createApiRoutes` and mount it on their Express instance.
 * Editing a route here automatically applies to both hosts.
 *
 * Tests exercise this module directly via supertest (see tests/api.test.js and
 * tests/shared.test.js) — no Electron needed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Helper Functions ─────────────────────────────────────────

/**
 * Write data to a file safely using a temp-file-then-rename strategy.
 * If the process crashes mid-write, the original file remains intact.
 * The temp file is cleaned up on failure so no orphans accumulate.
 */
function atomicWriteFile(filePath, content) {
  const tempFile = `${filePath}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, content, 'utf8');
    fs.renameSync(tempFile, filePath);
  } catch (err) {
    // Clean up the temp file if the rename failed
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (e) { /* best-effort cleanup */ }
    }
    throw err;
  }
}

/**
 * Check whether a string looks like a valid entity ID.
 * IDs are generated as 12-char lowercase hex (see generateId), but we accept
 * 8–20 chars to tolerate older or future formats without breaking lookups.
 */
function validateId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[a-z0-9]{8,20}$/.test(id);
}

/**
 * Safely load and parse a JSON file from disk.
 * Returns `defaultValue` if the file is missing, empty, or contains invalid JSON
 * — the caller never needs to handle errors for absent data files.
 */
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

/**
 * Trim whitespace and truncate a user-supplied string to `maxLength`.
 * Returns an empty string for null/undefined/non-string input, so callers
 * can safely assign the result without further null checks.
 */
function sanitizeString(str, maxLength = 1000) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().substring(0, maxLength);
}

/**
 * Generate a 12-character lowercase hex ID (48 bits of randomness).
 * Collision probability is negligible for a single-user local app.
 */
function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

// ── Validation Functions ─────────────────────────────────────
// Each validator returns an array of human-readable error strings.
// An empty array means the input is valid.

/**
 * Validate person fields.
 * Required: name (non-empty string, ≤200 chars).
 * Optional: role, team (strings, ≤200 chars each).
 */
function validatePersonData(data) {
  const errors = [];

  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    errors.push('Name is required');
  }

  if (data.name && data.name.length > 200) {
    errors.push('Name must be 200 characters or less');
  }

  if (data.role && (typeof data.role !== 'string' || data.role.length > 200)) {
    errors.push('Role must be 200 characters or less');
  }

  if (data.team && (typeof data.team !== 'string' || data.team.length > 200)) {
    errors.push('Team must be 200 characters or less');
  }

  return errors;
}

/**
 * Validate note fields.
 * Required: content (non-empty string, ≤50,000 chars).
 * Optional: title (string, ≤500 chars), tags (array of strings, max 20 items, each ≤50 chars).
 */
function validateNoteData(data) {
  const errors = [];

  if (!data.content || typeof data.content !== 'string' || !data.content.trim()) {
    errors.push('Content is required');
  }

  if (data.content && data.content.length > 50000) {
    errors.push('Content must be 50,000 characters or less');
  }

  if (data.title && (typeof data.title !== 'string' || data.title.length > 500)) {
    errors.push('Title must be 500 characters or less');
  }

  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      errors.push('Tags must be an array');
    } else {
      if (data.tags.length > 20) {
        errors.push('Maximum 20 tags per note');
      }
      const invalidTags = data.tags.filter(t => typeof t !== 'string' || t.length > 50 || t.length === 0);
      if (invalidTags.length > 0) {
        errors.push('Each tag must be a non-empty string of 50 characters or less');
      }
    }
  }

  return errors;
}

/**
 * Validate the questions array for the PUT /api/questions endpoint.
 * Must be a non-empty array of strings (max 500 items, each ≤1,000 chars).
 */
function validateQuestionsData(questions) {
  const errors = [];

  if (!Array.isArray(questions)) {
    errors.push('Questions must be an array');
    return errors;
  }

  if (questions.length === 0) {
    errors.push('At least one question is required');
  }

  if (questions.length > 500) {
    errors.push('Too many questions (max 500)');
  }

  const invalidQuestions = questions.filter(q =>
    typeof q !== 'string' || q.length > 1000
  );

  if (invalidQuestions.length > 0) {
    errors.push('Each question must be a string of 1,000 characters or less');
  }

  return errors;
}

// ── Default Data ─────────────────────────────────────────────
// These questions are seeded into questions.json on first run and shown as
// random prompts when creating a new meeting note.

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

// ── API Route Factory ────────────────────────────────────────
//
// This single function defines every REST endpoint the app exposes.
// Both main.js (Electron) and server.js (standalone web) call it with
// their own Express instance and data directory. This keeps the API
// logic in one place — never duplicate route definitions.

/**
 * Mount all API routes onto an Express app.
 *
 * @param {object} expressApp - The Express application instance
 * @param {object} options - Configuration options
 * @param {string} options.dataDir - Path to the data storage directory
 * @param {function} [options.getDataDir] - Optional function returning current data dir (for dynamic settings)
 * @param {function} [options.setDataDir] - Optional function to update data dir (for settings API)
 * @param {function} [options.loadSettings] - Optional function to load app settings (Electron only)
 * @param {function} [options.saveSettings] - Optional function to save app settings (Electron only)
 */
function createApiRoutes(expressApp, options) {
  // These paths are reassigned when the user changes their data location via settings
  let DATA_DIR = options.dataDir;
  let PEOPLE_FILE = path.join(DATA_DIR, 'people.json');
  let QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');

  // Bootstrap: ensure the data directory and seed files exist on first run
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PEOPLE_FILE)) fs.writeFileSync(PEOPLE_FILE, JSON.stringify([]));
  if (!fs.existsSync(QUESTIONS_FILE)) fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(defaultQuestions, null, 2));

  // ── Data access helpers ─────────────────────────────────────
  // All persistence goes through these thin wrappers so the routes above never
  // deal with file paths or JSON serialization directly.

  function loadPeople() {
    return safeLoadJSON(PEOPLE_FILE, []);
  }

  function savePeople(people) {
    atomicWriteFile(PEOPLE_FILE, JSON.stringify(people, null, 2));
  }

  // Each person's notes are stored in a separate file: notes_<personId>.json
  // This keeps individual files small and avoids rewriting everyone's notes on each save.
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

  function loadQuestions() {
    return safeLoadJSON(QUESTIONS_FILE, defaultQuestions);
  }

  function saveQuestions(questions) {
    atomicWriteFile(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
  }

  // ── Version API ─────────────────────────────────────────────
  // Exposes the app version from package.json for display in the settings modal.

  expressApp.get('/api/version', (req, res) => {
    const packageJson = safeLoadJSON(path.join(__dirname, 'package.json'), { version: '1.0.0' });
    res.json({ version: packageJson.version });
  });

  // ── People API ──────────────────────────────────────────────

  // List all people (used to populate the sidebar)
  expressApp.get('/api/people', (req, res) => {
    res.json(loadPeople());
  });

  // Create a new person entry
  expressApp.post('/api/people', (req, res) => {
    const validationErrors = validatePersonData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    const people = loadPeople();
    const person = {
      id: generateId(),
      name: sanitizeString(req.body.name, 200),
      role: sanitizeString(req.body.role || '', 200),
      team: sanitizeString(req.body.team || '', 200),
      createdAt: new Date().toISOString()
    };
    people.push(person);
    savePeople(people);
    res.status(201).json(person);
  });

  // Update an existing person's name/role/team
  expressApp.put('/api/people/:id', (req, res) => {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

    const people = loadPeople();
    const idx = people.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Person not found' });

    const validationErrors = validatePersonData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    people[idx] = {
      ...people[idx],
      name: sanitizeString(req.body.name, 200),
      role: sanitizeString(req.body.role || '', 200),
      team: sanitizeString(req.body.team || '', 200)
    };
    savePeople(people);
    res.json(people[idx]);
  });

  // Delete a person and cascade-delete their notes file
  expressApp.delete('/api/people/:id', (req, res) => {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

    const people = loadPeople();
    const idx = people.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Person not found' });

    people.splice(idx, 1);
    savePeople(people);

    // Cascade: remove the person's notes file so orphan data doesn't accumulate
    try {
    } catch (err) {
      console.error('Error deleting notes file:', err.message);
    }

    res.json({ ok: true });
  });

  // ── Notes API ───────────────────────────────────────────────
  // Notes belong to a person. Each person's notes are stored in their own file.

  // List notes for a person (returned newest-first for the UI)
  expressApp.get('/api/people/:id/notes', (req, res) => {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

    const people = loadPeople();
    if (!people.find(p => p.id === req.params.id)) return res.status(404).json({ error: 'Person not found' });
    const notes = loadNotes(req.params.id);
    res.json(notes.slice().reverse()); // newest-first for display
  });

  // Create a new note for a person
  expressApp.post('/api/people/:id/notes', (req, res) => {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

    const people = loadPeople();
    if (!people.find(p => p.id === req.params.id)) return res.status(404).json({ error: 'Person not found' });

    const validationErrors = validateNoteData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    const notes = loadNotes(req.params.id);
    const note = {
      id: generateId(),
      title: sanitizeString(req.body.title || '', 500),
      content: sanitizeString(req.body.content, 50000),
      tags: (req.body.tags || []).map(t => sanitizeString(t, 50).toLowerCase()).filter(t => t.length > 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    notes.push(note);
    saveNotes(req.params.id, notes);
    res.status(201).json(note);
  });

  // Update an existing note's content/title/tags
  expressApp.put('/api/people/:id/notes/:noteId', (req, res) => {
    if (!validateId(req.params.id) || !validateId(req.params.noteId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const notes = loadNotes(req.params.id);
    const idx = notes.findIndex(n => n.id === req.params.noteId);
    if (idx === -1) return res.status(404).json({ error: 'Note not found' });

    const validationErrors = validateNoteData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    notes[idx] = {
      ...notes[idx],
      title: sanitizeString(req.body.title || '', 500),
      content: sanitizeString(req.body.content, 50000),
      tags: (req.body.tags || []).map(t => sanitizeString(t, 50).toLowerCase()).filter(t => t.length > 0),
      updatedAt: new Date().toISOString()
    };
    saveNotes(req.params.id, notes);
    res.json(notes[idx]);
  });

  // Delete a single note
  expressApp.delete('/api/people/:id/notes/:noteId', (req, res) => {
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
  // Discussion questions shown as prompts when creating a new note.

  // List all questions
  expressApp.get('/api/questions', (req, res) => {
    res.json(loadQuestions());
  });

  // Replace the entire questions list
  expressApp.put('/api/questions', (req, res) => {
    const validationErrors = validateQuestionsData(req.body.questions);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    const cleaned = req.body.questions
      .map(q => sanitizeString(q, 1000))
      .filter(q => q.length > 0);

    if (cleaned.length === 0) {
      return res.status(400).json({ error: 'At least one valid question is required' });
    }

    saveQuestions(cleaned);
    res.json(cleaned);
  });

  // ── Tags API ────────────────────────────────────────────────
  // Returns a deduplicated, sorted list of every tag used across all notes.
  // Used by the frontend for tag autocomplete suggestions.

  expressApp.get('/api/tags', (req, res) => {
    const people = loadPeople();
    const tagSet = new Set();
    people.forEach(p => {
      const notes = loadNotes(p.id);
      notes.forEach(n => {
        if (n.tags && Array.isArray(n.tags)) {
          n.tags.forEach(t => tagSet.add(t));
        }
      });
    });
    res.json([...tagSet].sort());
  });

  // ── Search API ──────────────────────────────────────────────
  // Full-text search across all notes for all people.
  // Searches note title, content, and tags (case-insensitive substring match).
  // Returns matching notes enriched with person info, sorted by relevance then date.

  expressApp.get('/api/search', (req, res) => {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    if (query.length > 200) {
      return res.status(400).json({ error: 'Search query too long (max 200 characters)' });
    }

    const people = loadPeople();
    const results = [];

    people.forEach(person => {
      const notes = loadNotes(person.id);
      notes.forEach(note => {
        const titleMatch = (note.title || '').toLowerCase().includes(query);
        const contentMatch = (note.content || '').toLowerCase().includes(query);
        const tagMatch = (note.tags || []).some(t => t.toLowerCase().includes(query));

        if (titleMatch || contentMatch || tagMatch) {
          results.push({
            ...note,
            personId: person.id,
            personName: person.name,
            personRole: person.role,
            personTeam: person.team,
            // Title matches are most relevant, then tag, then content
            _relevance: (titleMatch ? 3 : 0) + (tagMatch ? 2 : 0) + (contentMatch ? 1 : 0)
          });
        }
      });
    });

    // Sort by relevance (highest first), then by date (newest first) as tiebreaker
    results.sort((a, b) => {
      if (b._relevance !== a._relevance) return b._relevance - a._relevance;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Strip the internal _relevance field before sending to the client
    const cleaned = results.map(({ _relevance, ...rest }) => rest);

    res.json(cleaned);
  });

  // ── Dashboard API ───────────────────────────────────────────
  // Returns all notes created in the last 14 days, enriched with the person's
  // name/role/team, sorted newest-first. Powers the "2-Week Dashboard" view.

  expressApp.get('/api/dashboard', (req, res) => {
    const people = loadPeople();
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    const recentNotes = [];
    
    people.forEach(person => {
      const notes = loadNotes(person.id);
      notes.forEach(note => {
        const noteDate = new Date(note.createdAt);
        if (noteDate >= twoWeeksAgo) {
          recentNotes.push({
            ...note,
            personId: person.id,
            personName: person.name,
            personRole: person.role,
            personTeam: person.team
          });
        }
      });
    });
    
    // Sort by date, newest first
    recentNotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(recentNotes);
  });

  // ── Settings API ───────────────────────────────────────────
  // Settings endpoints are only mounted when the host provides load/save callbacks.
  // In practice this means they're available in Electron (main.js) but not in
  // standalone web mode (server.js), which has no concept of user settings.

  if (options.loadSettings) {
    expressApp.get('/api/settings', (req, res) => {
      res.json(options.loadSettings());
    });
  }

  // Change the data storage location (Electron only — requires save/load settings)
  if (options.loadSettings && options.saveSettings) {
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
        const settings = options.loadSettings();
        settings.dataLocation = newLocation;
        options.saveSettings(settings);

        // Update internal paths
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
  }
}

// ── Exports ──────────────────────────────────────────────────

module.exports = {
  atomicWriteFile,
  validateId,
  safeLoadJSON,
  sanitizeString,
  generateId,
  validatePersonData,
  validateNoteData,
  validateQuestionsData,
  defaultQuestions,
  createApiRoutes
};
