/* ── State ────────────────────────────────────────────────── */
let people = [];
let currentPersonId = null;
let currentNotes = [];
let editingPersonId = null;
let editingNoteId = null;
let confirmCallback = null;
let noteCountCache = {};
let questions = [];
let currentQuestion = '';
let allTags = [];
let currentTags = [];
let filterTag = null;
let isDarkTheme = true; // Default to dark theme
let autosaveKeystrokeCount = 0;
let autosaveTimer = null;

/* ── API helpers ──────────────────────────────────────────── */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

/* ── Formatting ───────────────────────────────────────────── */
function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);

  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;

  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateFull(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function initials(name) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/* ── Theme Toggle ─────────────────────────────────────────── */
function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  document.body.classList.toggle('light-theme', !isDarkTheme);
  
  // Save preference to localStorage
  localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');
}

function loadThemePreference() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    isDarkTheme = false;
    document.body.classList.add('light-theme');
  }
}

/* ── Dashboard ────────────────────────────────────────────── */
async function showDashboard() {
  currentPersonId = null;
  
  // Update sidebar active state
  document.querySelectorAll('.person-item').forEach(el => {
    el.classList.remove('active');
  });

  // Hide other views
  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('personView').classList.add('hidden');
  
  // Show dashboard view
  const view = document.getElementById('dashboardView');
  view.classList.remove('hidden');

  try {
    const recentNotes = await api('GET', '/api/dashboard');
    renderDashboard(recentNotes);
  } catch (e) {
    showError(e.message);
  }
}

function renderDashboard(recentNotes) {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  
  const periodText = `${twoWeeksAgo.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  document.getElementById('dashboardPeriod').textContent = periodText;

  // Generate summary statistics
  const peopleWithNotes = new Set(recentNotes.map(n => n.personId)).size;
  const totalMeetings = recentNotes.length;
  const allTags = recentNotes.flatMap(n => n.tags || []);
  const tagCounts = {};
  allTags.forEach(tag => {
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  });
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  const summaryHtml = `
    <div class="dashboard-stats">
      <div class="dashboard-stat">
        <div class="dashboard-stat-value">${totalMeetings}</div>
        <div class="dashboard-stat-label">Total meetings</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-stat-value">${peopleWithNotes}</div>
        <div class="dashboard-stat-label">People met with</div>
      </div>
      ${topTags.length > 0 ? `
        <div class="dashboard-stat">
          <div class="dashboard-stat-label">Top tags</div>
          <div class="dashboard-tags">${topTags.map(t => `<span class="dashboard-tag">${escHtml(t)}</span>`).join('')}</div>
        </div>
      ` : ''}
    </div>
  `;
  document.getElementById('dashboardSummary').innerHTML = summaryHtml;

  // Render notes
  const notesContainer = document.getElementById('dashboardNotes');
  
  if (recentNotes.length === 0) {
    notesContainer.innerHTML = '<div class="dashboard-empty">No meetings in the last 2 weeks.</div>';
    return;
  }

  notesContainer.innerHTML = recentNotes.map(note => {
    const tagsHtml = (note.tags && note.tags.length > 0)
      ? `<div class="note-tags">${note.tags.map(t => `<span class="note-tag">${escHtml(t)}</span>`).join('')}</div>`
      : '';
    
    return `
      <div class="dashboard-note-card">
        <div class="dashboard-note-header">
          <div class="dashboard-note-person">
            <div class="dashboard-note-avatar">${initials(note.personName)}</div>
            <div>
              <div class="dashboard-note-person-name">${escHtml(note.personName)}</div>
              ${note.personRole || note.personTeam ? `<div class="dashboard-note-person-meta">${[note.personRole, note.personTeam].filter(Boolean).join(' · ')}</div>` : ''}
            </div>
          </div>
          <div class="dashboard-note-date">${formatDate(note.createdAt)}</div>
        </div>
        ${note.title ? `<div class="dashboard-note-title">${escHtml(note.title)}</div>` : ''}
        <div class="dashboard-note-content">${renderMarkdown(note.content)}</div>
        ${tagsHtml}
      </div>
    `;
  }).join('');
}

/* ── Render Sidebar ───────────────────────────────────────── */
function renderPeopleList(filter = '') {
  const list = document.getElementById('peopleList');
  const filtered = filter
    ? people.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || (p.role||'').toLowerCase().includes(filter.toLowerCase()))
    : people;

  if (filtered.length === 0) {
    list.innerHTML = `<li class="empty-state-sidebar">${filter ? 'No matches' : 'No one added yet'}</li>`;
    return;
  }

  list.innerHTML = filtered.map(p => {
    const count = noteCountCache[p.id] ?? '';
    return `
      <li class="person-item ${p.id === currentPersonId ? 'active' : ''}" data-id="${p.id}">
        <div class="person-item-avatar">${initials(p.name)}</div>
        <div class="person-item-info">
          <div class="person-item-name">${escHtml(p.name)}</div>
          ${p.role ? `<div class="person-item-role">${escHtml(p.role)}${p.team ? ` · ${escHtml(p.team)}` : ''}</div>` : ''}
        </div>
        ${count !== '' ? `<span class="person-item-count">${count}</span>` : ''}
      </li>`;
  }).join('');

  list.querySelectorAll('.person-item').forEach(el => {
    el.addEventListener('click', () => selectPerson(el.dataset.id));
  });
}

/* ── Select Person ────────────────────────────────────────── */
async function selectPerson(id) {
  currentPersonId = id;
  filterTag = null;
  const person = people.find(p => p.id === id);
  if (!person) return;

  // Update sidebar active state
  document.querySelectorAll('.person-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  // Hide other views
  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('dashboardView').classList.add('hidden');
  
  // Show person view
  const view = document.getElementById('personView');
  view.classList.remove('hidden');

  // Populate header
  document.getElementById('personAvatar').textContent = initials(person.name);
  document.getElementById('personName').textContent = person.name;
  const meta = [person.role, person.team].filter(Boolean).join(' · ');
  document.getElementById('personMeta').textContent = meta;

  // Load notes
  try {
    currentNotes = await api('GET', `/api/people/${id}/notes`);
    noteCountCache[id] = currentNotes.length;
    renderPeopleList(document.getElementById('searchPeople').value);
    renderNotes();
  } catch (e) {
    showError(e.message);
  }
}

/* ── Render Notes ─────────────────────────────────────────── */
function renderNotes() {
  const list = document.getElementById('notesList');
  const count = document.getElementById('notesCount');

  // Apply tag filter
  const displayNotes = filterTag
    ? currentNotes.filter(n => n.tags && n.tags.includes(filterTag))
    : currentNotes;

  count.textContent = `${displayNotes.length} note${displayNotes.length !== 1 ? 's' : ''}${filterTag ? ` tagged "${filterTag}"` : ''}`;

  // Render tag filter indicator
  renderTagFilter();

  if (displayNotes.length === 0) {
    list.innerHTML = `<div class="note-empty">${filterTag ? 'No notes with this tag.' : 'No notes yet — start recording your meetings.'}</div>`;
    return;
  }

  list.innerHTML = displayNotes.map(note => {
    const isEdited = note.updatedAt !== note.createdAt;
    const longNote = note.content.length > 400 || note.content.split('\n').length > 5;
    const tagsHtml = (note.tags && note.tags.length > 0)
      ? `<div class="note-tags">${note.tags.map(t => `<span class="note-tag" data-tag="${escHtml(t)}">${escHtml(t)}</span>`).join('')}</div>`
      : '';
    return `
      <div class="note-card" data-note-id="${note.id}">
        <div class="note-card-header">
          <div>
            <div class="note-title ${!note.title ? 'untitled' : ''}">${note.title ? escHtml(note.title) : 'Untitled meeting'}</div>
          </div>
          <div class="note-dates">
            <div>${formatDate(note.createdAt)}</div>
            <div title="${formatDateFull(note.createdAt)}">${formatDateFull(note.createdAt)}</div>
            ${isEdited ? `<div class="date-edited">edited ${formatDate(note.updatedAt)}</div>` : ''}
          </div>
        </div>
        <div class="note-content ${longNote ? 'collapsed' : ''}">${renderMarkdown(note.content)}</div>
        ${tagsHtml}
        <div class="note-footer">
          ${longNote ? `<button class="note-expand-btn" data-expanded="false">Show more ↓</button>` : '<span></span>'}
          <div class="note-actions">
            <button class="btn-note-action" data-action="edit" data-note-id="${note.id}">Edit</button>
            <button class="btn-note-action danger" data-action="delete" data-note-id="${note.id}">Delete</button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Expand/collapse
  list.querySelectorAll('.note-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.note-card');
      const content = card.querySelector('.note-content');
      const expanded = btn.dataset.expanded === 'true';
      if (expanded) {
        content.classList.add('collapsed');
        btn.textContent = 'Show more ↓';
        btn.dataset.expanded = 'false';
      } else {
        content.classList.remove('collapsed');
        btn.textContent = 'Show less ↑';
        btn.dataset.expanded = 'true';
      }
    });
  });

  // Edit / Delete note buttons
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, noteId } = btn.dataset;
      if (action === 'edit')   openEditNote(noteId);
      if (action === 'delete') deleteNote(noteId);
    });
  });

  // Tag click to filter
  list.querySelectorAll('.note-tag').forEach(el => {
    el.addEventListener('click', () => {
      filterTag = el.dataset.tag;
      renderNotes();
    });
  });
}

/* ── Tag Filter ───────────────────────────────────────────── */
function renderTagFilter() {
  const container = document.getElementById('tagFilter');
  if (!filterTag) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <span class="tag-filter-pill">
      ${escHtml(filterTag)}
      <button class="tag-filter-clear" id="clearTagFilter">✕</button>
    </span>`;
  document.getElementById('clearTagFilter').addEventListener('click', () => {
    filterTag = null;
    renderNotes();
  });
}

/* ── Tags Input (Note Modal) ─────────────────────────────── */
function renderTagsPills() {
  const container = document.getElementById('tagsInputPills');
  container.innerHTML = currentTags.map((t, i) => `
    <span class="tag-pill">
      ${escHtml(t)}
      <button class="tag-pill-remove" data-index="${i}">✕</button>
    </span>
  `).join('');
  container.querySelectorAll('.tag-pill-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentTags.splice(parseInt(btn.dataset.index), 1);
      renderTagsPills();
    });
  });
}

function showTagSuggestions(query) {
  const container = document.getElementById('tagsSuggestions');
  if (!query) {
    container.classList.add('hidden');
    return;
  }
  const matches = allTags.filter(t => 
    t.includes(query.toLowerCase()) && !currentTags.includes(t)
  ).slice(0, 5);
  if (matches.length === 0) {
    container.classList.add('hidden');
    return;
  }
  container.innerHTML = matches.map(t => 
    `<div class="tags-suggestion-item" data-tag="${escHtml(t)}">${escHtml(t)}</div>`
  ).join('');
  container.classList.remove('hidden');
  container.querySelectorAll('.tags-suggestion-item').forEach(el => {
    el.addEventListener('click', () => {
      addTag(el.dataset.tag);
      container.classList.add('hidden');
    });
  });
}

function addTag(tag) {
  const cleaned = tag.trim().toLowerCase().substring(0, 50);
  if (!cleaned || currentTags.includes(cleaned)) return;
  if (currentTags.length >= 20) return;
  currentTags.push(cleaned);
  renderTagsPills();
  document.getElementById('noteTagsInput').value = '';
  document.getElementById('tagsSuggestions').classList.add('hidden');
}

function wireTagsInput() {
  const input = document.getElementById('noteTagsInput');
  const wrapper = document.getElementById('tagsInputWrapper');

  wrapper.addEventListener('click', () => input.focus());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (input.value.trim()) addTag(input.value);
    }
    if (e.key === 'Backspace' && !input.value && currentTags.length > 0) {
      currentTags.pop();
      renderTagsPills();
    }
  });

  input.addEventListener('input', () => {
    showTagSuggestions(input.value.trim());
  });

  input.addEventListener('blur', () => {
    setTimeout(() => document.getElementById('tagsSuggestions').classList.add('hidden'), 150);
  });
}

/* ── Escape HTML ──────────────────────────────────────────── */
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Person Modal ─────────────────────────────────────────── */
function openAddPerson() {
  editingPersonId = null;
  document.getElementById('personModalTitle').textContent = 'Add person';
  document.getElementById('personNameInput').value = '';
  document.getElementById('personRoleInput').value = '';
  document.getElementById('personTeamInput').value = '';
  document.getElementById('personModal').classList.remove('hidden');
  document.getElementById('personNameInput').focus();
}

function openEditPerson(id) {
  const person = people.find(p => p.id === id);
  if (!person) return;
  editingPersonId = id;
  document.getElementById('personModalTitle').textContent = 'Edit person';
  document.getElementById('personNameInput').value = person.name;
  document.getElementById('personRoleInput').value = person.role || '';
  document.getElementById('personTeamInput').value = person.team || '';
  document.getElementById('personModal').classList.remove('hidden');
  document.getElementById('personNameInput').focus();
}

function closePersonModal() {
  document.getElementById('personModal').classList.add('hidden');
}

async function savePersonModal() {
  const name = document.getElementById('personNameInput').value.trim();
  const role = document.getElementById('personRoleInput').value.trim();
  const team = document.getElementById('personTeamInput').value.trim();

  if (!name) { document.getElementById('personNameInput').focus(); return; }

  try {
    if (editingPersonId) {
      const updated = await api('PUT', `/api/people/${editingPersonId}`, { name, role, team });
      const idx = people.findIndex(p => p.id === editingPersonId);
      if (idx !== -1) people[idx] = updated;
      if (currentPersonId === editingPersonId) {
        document.getElementById('personName').textContent = updated.name;
        document.getElementById('personAvatar').textContent = initials(updated.name);
        const meta = [updated.role, updated.team].filter(Boolean).join(' · ');
        document.getElementById('personMeta').textContent = meta;
      }
    } else {
      const person = await api('POST', '/api/people', { name, role, team });
      people.push(person);
      noteCountCache[person.id] = 0;
    }
    renderPeopleList(document.getElementById('searchPeople').value);
    closePersonModal();
  } catch (e) {
    showError(e.message);
  }
}

async function deletePerson(id) {
  const person = people.find(p => p.id === id);
  if (!person) return;
  showConfirm(
    'Delete person',
    `Remove ${person.name} and all their meeting notes? This cannot be undone.`,
    async () => {
      try {
        await api('DELETE', `/api/people/${id}`);
        people = people.filter(p => p.id !== id);
        delete noteCountCache[id];
        renderPeopleList(document.getElementById('searchPeople').value);
        if (currentPersonId === id) {
          currentPersonId = null;
          document.getElementById('personView').classList.add('hidden');
          document.getElementById('welcomeScreen').classList.remove('hidden');
        }
      } catch (e) { showError(e.message); }
    }
  );
}

/* ── Note Modal ───────────────────────────────────────────── */
function getRandomQuestion() {
  if (questions.length === 0) return 'No questions available';
  const idx = Math.floor(Math.random() * questions.length);
  return questions[idx];
}

function refreshQuestion() {
  currentQuestion = getRandomQuestion();
  document.getElementById('questionText').textContent = currentQuestion;
}

function showAutosaveIndicator() {
  const indicator = document.getElementById('autosaveIndicator');
  indicator.classList.remove('hidden');
  
  // Clear existing timer
  if (autosaveTimer) clearTimeout(autosaveTimer);
  
  // Hide after 3 seconds
  autosaveTimer = setTimeout(() => {
    indicator.classList.add('hidden');
  }, 3000);
}

async function autosaveNote() {
  if (!editingNoteId || !currentPersonId) return;
  
  const title = document.getElementById('noteTitleInput').value.trim();
  const content = document.getElementById('noteContentInput').value.trim();
  const tags = [...currentTags];

  if (!content) return;

  try {
    const updated = await api('PUT', `/api/people/${currentPersonId}/notes/${editingNoteId}`, { title, content, tags });
    const idx = currentNotes.findIndex(n => n.id === editingNoteId);
    if (idx !== -1) currentNotes[idx] = updated;
    
    // Update allTags with any new tags
    tags.forEach(t => { if (!allTags.includes(t)) allTags.push(t); });
    allTags.sort();
    
    showAutosaveIndicator();
  } catch (e) {
    console.error('Autosave failed:', e.message);
  }
}

function setupAutosave() {
  const textarea = document.getElementById('noteContentInput');
  
  textarea.addEventListener('input', () => {
    if (!editingNoteId) return; // Only autosave when editing existing notes
    
    autosaveKeystrokeCount++;
    
    if (autosaveKeystrokeCount >= 20) {
      autosaveKeystrokeCount = 0;
      autosaveNote();
    }
  });
}

function resetAutosave() {
  autosaveKeystrokeCount = 0;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  document.getElementById('autosaveIndicator').classList.add('hidden');
}

function openNewNote() {
  editingNoteId = null;
  currentTags = [];
  resetAutosave();
  switchNoteTab('write');
  document.getElementById('noteModalTitle').textContent = 'New meeting note';
  document.getElementById('noteTitleInput').value = '';
  document.getElementById('noteContentInput').value = '';
  document.getElementById('noteTagsInput').value = '';
  renderTagsPills();
  refreshQuestion();
  document.getElementById('noteModal').classList.remove('hidden');
  document.getElementById('noteTitleInput').focus();
}

function openEditNote(noteId) {
  const note = currentNotes.find(n => n.id === noteId);
  if (!note) return;
  editingNoteId = noteId;
  currentTags = [...(note.tags || [])];
  resetAutosave();
  switchNoteTab('write');
  document.getElementById('noteModalTitle').textContent = 'Edit note';
  document.getElementById('noteTitleInput').value = note.title || '';
  document.getElementById('noteContentInput').value = note.content;
  document.getElementById('noteTagsInput').value = '';
  renderTagsPills();
  document.getElementById('noteModal').classList.remove('hidden');
  document.getElementById('noteTitleInput').focus();
}

async function saveOnModalClose() {
  const content = document.getElementById('noteContentInput').value.trim();
  if (!content) {
    closeNoteModal();
    return;
  }
  
  if (editingNoteId) {
    await autosaveNote();
    renderNotes();
  } else {
    await saveNoteModal();
    return;
  }
  
  closeNoteModal();
}

function closeNoteModal() {
  resetAutosave();
  document.getElementById('noteModal').classList.add('hidden');
}

async function saveNoteModal() {
  const title = document.getElementById('noteTitleInput').value.trim();
  const content = document.getElementById('noteContentInput').value.trim();
  const tags = [...currentTags];

  if (!content) { document.getElementById('noteContentInput').focus(); return; }

  try {
    if (editingNoteId) {
      const updated = await api('PUT', `/api/people/${currentPersonId}/notes/${editingNoteId}`, { title, content, tags });
      const idx = currentNotes.findIndex(n => n.id === editingNoteId);
      if (idx !== -1) currentNotes[idx] = updated;
    } else {
      const note = await api('POST', `/api/people/${currentPersonId}/notes`, { title, content, tags });
      currentNotes.unshift(note); // newest first
      noteCountCache[currentPersonId] = (noteCountCache[currentPersonId] || 0) + 1;
      renderPeopleList(document.getElementById('searchPeople').value);
    }
    // Update allTags with any new tags
    tags.forEach(t => { if (!allTags.includes(t)) allTags.push(t); });
    allTags.sort();
    renderNotes();
    closeNoteModal();
  } catch (e) {
    showError(e.message);
  }
}

async function deleteNote(noteId) {
  showConfirm('Delete note', 'Delete this meeting note? This cannot be undone.', async () => {
    try {
      await api('DELETE', `/api/people/${currentPersonId}/notes/${noteId}`);
      currentNotes = currentNotes.filter(n => n.id !== noteId);
      noteCountCache[currentPersonId] = Math.max(0, (noteCountCache[currentPersonId] || 1) - 1);
      renderPeopleList(document.getElementById('searchPeople').value);
      renderNotes();
    } catch (e) { showError(e.message); }
  });
}

/* ── Questions Modal ──────────────────────────────────────── */
function openManageQuestions() {
  document.getElementById('questionsTextarea').value = questions.join('\n');
  document.getElementById('questionsModal').classList.remove('hidden');
  document.getElementById('questionsTextarea').focus();
}

function closeQuestionsModal() {
  document.getElementById('questionsModal').classList.add('hidden');
}

async function saveQuestionsModal() {
  const text = document.getElementById('questionsTextarea').value;
  const newQuestions = text.split('\n').map(q => q.trim()).filter(q => q.length > 0);
  
  if (newQuestions.length === 0) {
    showError('Please add at least one question');
    return;
  }

  try {
    questions = await api('PUT', '/api/questions', { questions: newQuestions });
    closeQuestionsModal();
  } catch (e) {
    showError(e.message);
  }
}

/* ── Settings Modal ───────────────────────────────────────── */
let pendingDataLocation = null;

async function openSettings() {
  try {
    const settings = await api('GET', '/api/settings');
    document.getElementById('dataLocationInput').value = settings.dataLocation;
    document.getElementById('dataLocationNote').textContent = `Current: ${settings.dataLocation}`;
    pendingDataLocation = settings.dataLocation;
    document.getElementById('settingsModal').classList.remove('hidden');
  } catch (e) {
    showError(e.message);
  }
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
  pendingDataLocation = null;
}

async function selectFolder() {
  if (window.electronAPI && window.electronAPI.selectFolder) {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      pendingDataLocation = folder;
      document.getElementById('dataLocationInput').value = folder;
    }
  } else {
    showError('Folder selection only available in desktop app');
  }
}

async function saveSettingsModal() {
  if (!pendingDataLocation) {
    showError('Please select a data location');
    return;
  }

  try {
    await api('PUT', '/api/settings/data-location', { dataLocation: pendingDataLocation });
    closeSettingsModal();
    // Reload the page to use new data location
    window.location.reload();
  } catch (e) {
    showError(e.message);
  }
}

/* ── Confirm Modal ────────────────────────────────────────── */
function showConfirm(title, message, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = onOk;
  document.getElementById('confirmModal').classList.remove('hidden');
}

function closeConfirm() {
  confirmCallback = null;
  document.getElementById('confirmModal').classList.add('hidden');
}

/* ── Error (toast-lite) ───────────────────────────────────── */
function showError(msg) {
  console.error(msg);
  // Simple alert fallback — could be a toast in future
  alert(`Error: ${msg}`);
}

/* ── Bootstrap note counts ────────────────────────────────── */
async function loadNoteCounts() {
  await Promise.all(people.map(async p => {
    try {
      const notes = await api('GET', `/api/people/${p.id}/notes`);
      noteCountCache[p.id] = notes.length;
    } catch { noteCountCache[p.id] = 0; }
  }));
  renderPeopleList();
}

/* ── Event Wiring ─────────────────────────────────────────── */
function wireEvents() {
  // Sidebar search
  document.getElementById('searchPeople').addEventListener('input', e => {
    renderPeopleList(e.target.value);
  });

  // Add person button
  document.getElementById('addPersonBtn').addEventListener('click', openAddPerson);

  // Dashboard button
  document.getElementById('dashboardBtn').addEventListener('click', showDashboard);

  // Edit / delete current person
  document.getElementById('editPersonBtn').addEventListener('click', () => {
    if (currentPersonId) openEditPerson(currentPersonId);
  });
  document.getElementById('deletePersonBtn').addEventListener('click', () => {
    if (currentPersonId) deletePerson(currentPersonId);
  });

  // New note button
  document.getElementById('newNoteBtn').addEventListener('click', openNewNote);

  // Refresh question button
  document.getElementById('refreshQuestionBtn').addEventListener('click', refreshQuestion);

  // Manage questions button
  document.getElementById('manageQuestionsBtn').addEventListener('click', openManageQuestions);

  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', openSettings);

  // Theme toggle button
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

  // Person modal
  document.getElementById('personModalClose').addEventListener('click', closePersonModal);
  document.getElementById('personModalCancel').addEventListener('click', closePersonModal);
  document.getElementById('personModalSave').addEventListener('click', savePersonModal);
  document.getElementById('personModal').addEventListener('click', e => {
    if (e.target === document.getElementById('personModal')) closePersonModal();
  });

  // Note modal
  document.getElementById('noteModalClose').addEventListener('click', saveOnModalClose);
  document.getElementById('noteModalCancel').addEventListener('click', saveOnModalClose);
  document.getElementById('noteModalSave').addEventListener('click', saveNoteModal);
  document.getElementById('noteModal').addEventListener('click', async e => {
    if (e.target === document.getElementById('noteModal')) {
      await saveOnModalClose();
    }
  });

  // Note editor tabs (Write / Preview)
  document.getElementById('noteTabWrite').addEventListener('click', () => switchNoteTab('write'));
  document.getElementById('noteTabPreview').addEventListener('click', () => switchNoteTab('preview'));

  // Confirm modal
  document.getElementById('confirmCancel').addEventListener('click', closeConfirm);
  document.getElementById('confirmModal').addEventListener('click', e => {
    if (e.target === document.getElementById('confirmModal')) closeConfirm();
  });
  document.getElementById('confirmOk').addEventListener('click', async () => {
    if (confirmCallback) await confirmCallback();
    closeConfirm();
  });

  // Questions modal
  document.getElementById('questionsModalClose').addEventListener('click', closeQuestionsModal);
  document.getElementById('questionsModalCancel').addEventListener('click', closeQuestionsModal);
  document.getElementById('questionsModalSave').addEventListener('click', saveQuestionsModal);
  document.getElementById('questionsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('questionsModal')) closeQuestionsModal();
  });

  // Settings modal
  document.getElementById('settingsModalClose').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsModalCancel').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsModalSave').addEventListener('click', saveSettingsModal);
  document.getElementById('selectFolderBtn').addEventListener('click', selectFolder);
  document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('settingsModal')) closeSettingsModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', async e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('confirmModal').classList.contains('hidden'))  closeConfirm();
      else if (!document.getElementById('settingsModal').classList.contains('hidden')) closeSettingsModal();
      else if (!document.getElementById('questionsModal').classList.contains('hidden')) closeQuestionsModal();
      else if (!document.getElementById('noteModal').classList.contains('hidden')) await saveOnModalClose();
      else if (!document.getElementById('personModal').classList.contains('hidden')) closePersonModal();
    }
    // Ctrl/Cmd+Enter to save in modals
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (!document.getElementById('noteModal').classList.contains('hidden')) saveNoteModal();
      else if (!document.getElementById('personModal').classList.contains('hidden')) savePersonModal();
      else if (!document.getElementById('questionsModal').classList.contains('hidden')) saveQuestionsModal();
    }
  });
}

/* ── Note Editor Tabs (Write/Preview) ─────────────────────── */
function switchNoteTab(tab) {
  const writeTab = document.getElementById('noteTabWrite');
  const previewTab = document.getElementById('noteTabPreview');
  const writePane = document.getElementById('noteWritePane');
  const previewPane = document.getElementById('notePreviewPane');
  const previewContent = document.getElementById('notePreviewContent');

  if (tab === 'preview') {
    const content = document.getElementById('noteContentInput').value;
    previewContent.innerHTML = content.trim()
      ? renderMarkdown(content)
      : '<p style="color:var(--text-dim);font-style:italic;">Nothing to preview</p>';
    writePane.classList.add('hidden');
    previewPane.classList.remove('hidden');
    writeTab.classList.remove('active');
    previewTab.classList.add('active');
  } else {
    writePane.classList.remove('hidden');
    previewPane.classList.add('hidden');
    writeTab.classList.add('active');
    previewTab.classList.remove('active');
  }
}

/* ── Markdown Toolbar ──────────────────────────────────────── */
function wireMarkdownToolbar() {
  document.getElementById('mdToolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-md]');
    if (!btn) return;
    const action = btn.dataset.md;
    const textarea = document.getElementById('noteContentInput');
    applyMarkdownAction(textarea, action);
    textarea.focus();
  });

  // Keyboard shortcuts in textarea
  document.getElementById('noteContentInput').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      applyMarkdownAction(document.getElementById('noteContentInput'), 'bold');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      applyMarkdownAction(document.getElementById('noteContentInput'), 'italic');
    }
  });
}

function applyMarkdownAction(textarea, action) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);
  let before = '', after = '', insert = '';

  switch (action) {
    case 'bold':
      before = '**'; after = '**';
      insert = selected || 'bold text';
      break;
    case 'italic':
      before = '*'; after = '*';
      insert = selected || 'italic text';
      break;
    case 'heading':
      before = '## '; after = '';
      insert = selected || 'Heading';
      break;
    case 'ul':
      before = '- '; after = '';
      insert = selected || 'List item';
      break;
    case 'ol':
      before = '1. '; after = '';
      insert = selected || 'List item';
      break;
    case 'code':
      before = '`'; after = '`';
      insert = selected || 'code';
      break;
    case 'link':
      before = '['; after = '](url)';
      insert = selected || 'link text';
      break;
    case 'checkbox':
      before = '- [ ] '; after = '';
      insert = selected || 'Task';
      break;
  }

  const replacement = before + insert + after;
  textarea.value = text.substring(0, start) + replacement + text.substring(end);

  // Position cursor: select the inserted text (between markers)
  const cursorStart = start + before.length;
  const cursorEnd = cursorStart + insert.length;
  textarea.setSelectionRange(cursorStart, cursorEnd);
}

/* ── Voice recording → local transcription ────────────────── */
let mediaRecorder = null;
let recordedChunks = [];
let recordSources = [];   // raw MediaStreams to stop on cleanup
let mixContext = null;    // AudioContext used when mixing mic + system
let recordStream = null;  // audio-only stream fed to MediaRecorder
let recordTimerInterval = null;
let recordStartTime = 0;
let isTranscribing = false;

// Live (chunked) transcription state. While recording, audio is transcribed in
// the background every LIVE_CHUNK_MS so that by the time the user hits Stop most
// of the work is already done — only the final tail and the summary remain.
let liveInterval = null;      // timer that kicks off background chunks
let liveTranscript = '';      // running transcript assembled from chunks
let processedSamples = 0;     // 16kHz-sample cursor: audio already transcribed
let liveBusy = false;         // a chunk transcription is in flight
let liveOpPromise = null;     // resolves when the in-flight chunk finishes

const SAMPLE_RATE = 16000;
const LIVE_CHUNK_MS = 20000;                       // attempt a chunk every 20s
const LIVE_MIN_CHUNK_SAMPLES = SAMPLE_RATE * 4;    // need ≥4s of new audio
const LIVE_EDGE_GUARD_SAMPLES = SAMPLE_RATE * 0.8; // leave ~0.8s live edge unprocessed

// Recording-duration thresholds (seconds): warn near, then past, ~15 min.
const RECORD_WARN_SECONDS = 13 * 60;
const RECORD_HARD_SECONDS = 15 * 60;

function transcriptionSupported() {
  return !!(window.electronAPI && window.electronAPI.transcribeAudio &&
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function wireRecordButton() {
  const btn = document.getElementById('recordBtn');
  if (!btn || !transcriptionSupported()) return; // stays hidden (e.g. web mode)
  try {
    const available = await window.electronAPI.transcriptionAvailable();
    if (!available) return; // model not present — keep hidden
  } catch {
    return;
  }
  btn.classList.remove('hidden');
  document.getElementById('recordSource').classList.remove('hidden');
  btn.addEventListener('click', toggleRecording);
}

function setRecordStatus(text) {
  document.getElementById('recordStatus').textContent = text || '';
}

async function toggleRecording() {
  if (isTranscribing) return;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    await startRecording();
  }
}

// Build a single audio-only MediaStream from the selected source(s).
async function buildCaptureStream(mode) {
  let micStream = null;
  let sysStream = null;

  if (mode === 'mic' || mode === 'both') {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordSources.push(micStream);
  }
  if (mode === 'system' || mode === 'both') {
    // Video is required for loopback capture in Electron; we discard it.
    sysStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    recordSources.push(sysStream);
    sysStream.getVideoTracks().forEach((t) => t.stop());
    if (!sysStream.getAudioTracks().length) {
      throw new Error('No system audio track available');
    }
  }

  if (mode === 'mic') return new MediaStream(micStream.getAudioTracks());
  if (mode === 'system') return new MediaStream(sysStream.getAudioTracks());

  // both → mix into one track via Web Audio
  mixContext = new (window.AudioContext || window.webkitAudioContext)();
  const dest = mixContext.createMediaStreamDestination();
  mixContext.createMediaStreamSource(new MediaStream(micStream.getAudioTracks())).connect(dest);
  mixContext.createMediaStreamSource(new MediaStream(sysStream.getAudioTracks())).connect(dest);
  return dest.stream;
}

async function startRecording() {
  const mode = document.getElementById('recordSource').value;
  recordSources = [];
  mixContext = null;
  try {
    recordStream = await buildCaptureStream(mode);
  } catch (e) {
    console.error('Capture failed:', e);
    cleanupRecordStream();
    setRecordStatus(mode === 'mic' ? 'Microphone access denied' : 'Audio capture unavailable');
    return;
  }

  recordedChunks = [];
  liveTranscript = '';
  processedSamples = 0;
  liveBusy = false;
  liveOpPromise = null;
  mediaRecorder = new MediaRecorder(recordStream);
  // A 1s timeslice makes data available regularly so the cumulative blob keeps
  // growing and can be transcribed mid-recording.
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = handleRecordingStop;
  mediaRecorder.start(1000);

  document.getElementById('recordSource').disabled = true;
  const btn = document.getElementById('recordBtn');
  btn.classList.add('recording');
  document.getElementById('recordBtnLabel').textContent = 'Stop';
  recordStartTime = Date.now();
  updateRecordTimer();
  recordTimerInterval = setInterval(updateRecordTimer, 1000);
  liveInterval = setInterval(() => { transcribeLiveChunk(false); }, LIVE_CHUNK_MS);
}

function updateRecordTimer() {
  const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  const live = liveTranscript ? ` · transcribing ${liveTranscript.split(/\s+/).filter(Boolean).length}w` : '';
  setRecordStatus(`Recording ${m}:${s}${live}`);
  updateRecordWarning(elapsed);
}

// Warn as the recording approaches the ~15 min point, where transcription
// becomes slow and memory-heavy.
function updateRecordWarning(elapsed) {
  const warning = document.getElementById('recordWarning');
  if (elapsed >= RECORD_HARD_SECONDS) {
    warning.textContent = '⚠ Very long recording — transcription will be slow & memory-heavy';
    warning.classList.remove('hidden');
    warning.classList.add('severe');
  } else if (elapsed >= RECORD_WARN_SECONDS) {
    const remaining = Math.max(0, Math.ceil((RECORD_HARD_SECONDS - elapsed) / 60));
    warning.textContent = `⚠ Approaching ${RECORD_HARD_SECONDS / 60} min — consider stopping soon (~${remaining} min left)`;
    warning.classList.remove('hidden', 'severe');
  } else {
    clearRecordWarning();
  }
}

function clearRecordWarning() {
  const warning = document.getElementById('recordWarning');
  warning.classList.add('hidden');
  warning.classList.remove('severe');
  warning.textContent = '';
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

function cleanupRecordStream() {
  recordSources.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  recordSources = [];
  if (mixContext) {
    mixContext.close();
    mixContext = null;
  }
  recordStream = null;
  if (recordTimerInterval) {
    clearInterval(recordTimerInterval);
    recordTimerInterval = null;
  }
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }
}

async function handleRecordingStop() {
  const btn = document.getElementById('recordBtn');
  btn.classList.remove('recording');
  document.getElementById('recordBtnLabel').textContent = 'Record';
  clearRecordWarning();
  cleanupRecordStream(); // also stops the live-chunk interval

  if (!recordedChunks.length) { setRecordStatus(''); return; }

  isTranscribing = true;
  btn.classList.add('transcribing');
  btn.disabled = true;
  setRecordStatus('Finishing transcription…');

  try {
    // Let any chunk that was mid-flight when Stop was pressed finish first…
    if (liveOpPromise) { try { await liveOpPromise; } catch { /* logged in chunk */ } }
    // …then transcribe everything still after the last cut (force = whole tail).
    await transcribeLiveChunk(true);

    const text = liveTranscript.trim();
    if (text) {
      const summary = summarizeToBullets(text);
      insertTranscript(summary);
      setRecordStatus('Summarised');
    } else {
      setRecordStatus('No speech detected');
    }
  } catch (e) {
    console.error('Transcription failed:', e);
    setRecordStatus('Transcription failed');
  } finally {
    isTranscribing = false;
    btn.classList.remove('transcribing');
    btn.disabled = false;
    document.getElementById('recordSource').disabled = false;
    setTimeout(() => {
      const recording = mediaRecorder && mediaRecorder.state === 'recording';
      if (!isTranscribing && !recording) setRecordStatus('');
    }, 3000);
  }
}

// Transcribe the audio captured since the last cut. Runs in the background while
// recording (force=false, leaves a small live-edge guard and cuts on a pause) and
// once more at Stop (force=true, flushes the entire remaining tail).
// Re-decodes the cumulative blob each time: decoding is cheap next to Whisper, and
// it reuses the same battle-tested decode path as the final transcription.
async function transcribeLiveChunk(force) {
  if (liveBusy || !recordedChunks.length) return;
  liveBusy = true;
  liveOpPromise = (async () => {
    try {
      const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || 'audio/webm' });
      const pcm = await blobToPcm16kMono(blob);
      const edge = force ? pcm.length : Math.max(0, pcm.length - LIVE_EDGE_GUARD_SAMPLES);
      const available = edge - processedSamples;
      if (available < (force ? 1 : LIVE_MIN_CHUNK_SAMPLES)) return;

      const cut = force ? edge : findQuietCut(pcm, processedSamples, edge);
      // Copy into a tightly-sized buffer so IPC doesn't ship the whole recording.
      const chunkPcm = new Float32Array(pcm.subarray(processedSamples, cut));
      if (!chunkPcm.length) return;

      const text = await window.electronAPI.transcribeAudio(chunkPcm);
      if (text) liveTranscript += (liveTranscript ? ' ' : '') + text;
      processedSamples = cut;
    } catch (e) {
      console.error('Live transcription chunk failed:', e);
    } finally {
      liveBusy = false;
    }
  })();
  return liveOpPromise;
}

// Pick a cut point near maxIdx that falls on the quietest moment (likely a pause
// between words), minimising mid-word splits at chunk seams. Searches the last
// ~2s before the edge for the lowest-energy 30ms window.
function findQuietCut(pcm, fromIdx, maxIdx) {
  const searchStart = Math.max(fromIdx + SAMPLE_RATE, maxIdx - 2 * SAMPLE_RATE);
  if (searchStart >= maxIdx) return maxIdx;
  const winLen = Math.floor(SAMPLE_RATE * 0.03);
  let bestIdx = maxIdx;
  let bestEnergy = Infinity;
  for (let i = searchStart; i + winLen <= maxIdx; i += winLen) {
    let sum = 0;
    for (let j = i; j < i + winLen; j++) sum += pcm[j] * pcm[j];
    if (sum < bestEnergy) { bestEnergy = sum; bestIdx = i + (winLen >> 1); }
  }
  return bestIdx;
}

// Decode any captured audio and resample to the 16kHz mono PCM Whisper expects.
async function blobToPcm16kMono(blob) {
  const arrayBuf = await blob.arrayBuffer();
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await decodeCtx.decodeAudioData(arrayBuf);
  decodeCtx.close();
  const length = Math.ceil(decoded.duration * 16000);
  const offline = new OfflineAudioContext(1, length, 16000);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Common English stopwords ignored when scoring sentence importance.
const SUMMARY_STOPWORDS = new Set(('a an and the of to in on for with at by from up about into over after ' +
  'is are was were be been being am do does did doing have has had having will would shall should can could ' +
  'may might must this that these those it its it\'s i you he she we they me him her us them my your his our their ' +
  'so but or nor if then else than as too very just not no yes ok okay yeah um uh like really actually basically ' +
  'kind sort going get got go went said say says know think thing things stuff well right mean lot bit one').split(/\s+/));

function summaryWords(s) {
  return (s.toLowerCase().match(/[a-z0-9']+/g) || []);
}

function tidySentence(s) {
  let out = s.trim().replace(/\s+/g, ' ');
  if (!out) return out;
  out = out.charAt(0).toUpperCase() + out.slice(1);
  if (!/[.!?]$/.test(out)) out += '.';
  return out;
}

// Extractive, fully on-device summariser: scores sentences by the frequency of
// their meaningful (non-stopword) terms and keeps the top few, in original order.
function summarizeToBullets(transcript) {
  const clean = (transcript || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  const sentences = (clean.match(/[^.!?]+[.!?]*/g) || [clean])
    .map((s) => s.trim())
    .filter((s) => summaryWords(s).length >= 4);

  // Too short to summarise meaningfully — bullet it as-is.
  if (sentences.length <= 1) {
    return '- ' + tidySentence(clean);
  }

  const freq = Object.create(null);
  sentences.forEach((s) => {
    summaryWords(s).forEach((w) => {
      if (!SUMMARY_STOPWORDS.has(w) && w.length > 2) {
        freq[w] = (freq[w] || 0) + 1;
      }
    });
  });

  const scored = sentences.map((s, i) => {
    const terms = summaryWords(s).filter((w) => !SUMMARY_STOPWORDS.has(w) && w.length > 2);
    const raw = terms.reduce((sum, w) => sum + (freq[w] || 0), 0);
    // Normalise by sqrt(length) so long sentences don't dominate.
    const score = terms.length ? raw / Math.sqrt(terms.length) : 0;
    return { s, i, score };
  });

  const count = Math.min(7, Math.max(3, Math.round(sentences.length * 0.3)));
  const top = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.i - b.i); // restore chronological order

  return top.map((o) => '- ' + tidySentence(o.s)).join('\n');
}

function insertTranscript(text) {
  const textarea = document.getElementById('noteContentInput');
  const existing = textarea.value;
  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  const prefix = existing.length === 0 ? '' : (needsNewline ? '\n\n' : '');
  textarea.value = existing + prefix + text;
  textarea.dispatchEvent(new Event('input'));
  if (editingNoteId) autosaveNote();
}

/* ── Init ─────────────────────────────────────────────────── */
async function init() {
  try {
    loadThemePreference(); // Load theme before rendering
    people = await api('GET', '/api/people');
    questions = await api('GET', '/api/questions');
    allTags = await api('GET', '/api/tags');
    renderPeopleList();
    wireEvents();
    wireTagsInput();
    wireMarkdownToolbar();
    wireRecordButton();
    setupAutosave();
    await loadNoteCounts();
    await loadVersion();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#c0504d;">Failed to connect to server: ${e.message}</div>`;
  }
}

async function loadVersion() {
  try {
    const data = await api('GET', '/api/version');
    document.getElementById('versionDisplay').textContent = `v${data.version}`;
  } catch (e) {
    console.warn('Failed to load version:', e);
  }
}

init();
