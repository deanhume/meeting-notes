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
  const person = people.find(p => p.id === id);
  if (!person) return;

  // Update sidebar active state
  document.querySelectorAll('.person-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  // Show person view
  document.getElementById('welcomeScreen').classList.add('hidden');
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
  count.textContent = `${currentNotes.length} note${currentNotes.length !== 1 ? 's' : ''}`;

  if (currentNotes.length === 0) {
    list.innerHTML = `<div class="note-empty">No notes yet — start recording your meetings.</div>`;
    return;
  }

  list.innerHTML = currentNotes.map(note => {
    const isEdited = note.updatedAt !== note.createdAt;
    const longNote = note.content.length > 400 || note.content.split('\n').length > 5;
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
        <div class="note-content ${longNote ? 'collapsed' : ''}">${escHtml(note.content)}</div>
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

function openNewNote() {
  editingNoteId = null;
  document.getElementById('noteModalTitle').textContent = 'New meeting note';
  document.getElementById('noteTitleInput').value = '';
  document.getElementById('noteContentInput').value = '';
  refreshQuestion();
  document.getElementById('noteModal').classList.remove('hidden');
  document.getElementById('noteTitleInput').focus();
}

function openEditNote(noteId) {
  const note = currentNotes.find(n => n.id === noteId);
  if (!note) return;
  editingNoteId = noteId;
  document.getElementById('noteModalTitle').textContent = 'Edit note';
  document.getElementById('noteTitleInput').value = note.title || '';
  document.getElementById('noteContentInput').value = note.content;
  document.getElementById('noteModal').classList.remove('hidden');
  document.getElementById('noteTitleInput').focus();
}

function closeNoteModal() {
  document.getElementById('noteModal').classList.add('hidden');
}

async function saveNoteModal() {
  const title = document.getElementById('noteTitleInput').value.trim();
  const content = document.getElementById('noteContentInput').value.trim();

  if (!content) { document.getElementById('noteContentInput').focus(); return; }

  try {
    if (editingNoteId) {
      const updated = await api('PUT', `/api/people/${currentPersonId}/notes/${editingNoteId}`, { title, content });
      const idx = currentNotes.findIndex(n => n.id === editingNoteId);
      if (idx !== -1) currentNotes[idx] = updated;
    } else {
      const note = await api('POST', `/api/people/${currentPersonId}/notes`, { title, content });
      currentNotes.unshift(note); // newest first
      noteCountCache[currentPersonId] = (noteCountCache[currentPersonId] || 0) + 1;
      renderPeopleList(document.getElementById('searchPeople').value);
    }
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

  // Person modal
  document.getElementById('personModalClose').addEventListener('click', closePersonModal);
  document.getElementById('personModalCancel').addEventListener('click', closePersonModal);
  document.getElementById('personModalSave').addEventListener('click', savePersonModal);
  document.getElementById('personModal').addEventListener('click', e => {
    if (e.target === document.getElementById('personModal')) closePersonModal();
  });

  // Note modal
  document.getElementById('noteModalClose').addEventListener('click', closeNoteModal);
  document.getElementById('noteModalCancel').addEventListener('click', closeNoteModal);
  document.getElementById('noteModalSave').addEventListener('click', saveNoteModal);
  document.getElementById('noteModal').addEventListener('click', e => {
    if (e.target === document.getElementById('noteModal')) closeNoteModal();
  });

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
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('confirmModal').classList.contains('hidden'))  closeConfirm();
      else if (!document.getElementById('settingsModal').classList.contains('hidden')) closeSettingsModal();
      else if (!document.getElementById('questionsModal').classList.contains('hidden')) closeQuestionsModal();
      else if (!document.getElementById('noteModal').classList.contains('hidden')) closeNoteModal();
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

/* ── Init ─────────────────────────────────────────────────── */
async function init() {
  try {
    people = await api('GET', '/api/people');
    questions = await api('GET', '/api/questions');
    renderPeopleList();
    wireEvents();
    await loadNoteCounts();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#c0504d;">Failed to connect to server: ${e.message}</div>`;
  }
}

init();
