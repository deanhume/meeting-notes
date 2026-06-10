const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');
const { createApiRoutes } = require('./shared');

let app;
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-notes-api-'));
  app = express();
  app.use(express.json());
  createApiRoutes(app, { dataDir: tmpDir });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── People API ───────────────────────────────────────────────

describe('People API', () => {
  test('GET /api/people returns empty array initially', async () => {
    const res = await request(app).get('/api/people');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/people creates a person', async () => {
    const res = await request(app)
      .post('/api/people')
      .send({ name: 'Alice', role: 'Engineer', team: 'Platform' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Alice');
    expect(res.body.id).toBeDefined();
  });

  test('POST /api/people validates name required', async () => {
    const res = await request(app).post('/api/people').send({ name: '' });
    expect(res.status).toBe(400);
  });

  test('PUT /api/people/:id updates a person', async () => {
    const create = await request(app).post('/api/people').send({ name: 'Alice' });
    const id = create.body.id;

    const res = await request(app)
      .put(`/api/people/${id}`)
      .send({ name: 'Alice Updated', role: 'Lead' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Updated');
  });

  test('PUT /api/people/:id returns 404 for unknown ID', async () => {
    const res = await request(app)
      .put('/api/people/aabbccddee11')
      .send({ name: 'Bob' });
    expect(res.status).toBe(404);
  });

  test('DELETE /api/people/:id removes a person', async () => {
    const create = await request(app).post('/api/people').send({ name: 'Alice' });
    const id = create.body.id;

    const res = await request(app).delete(`/api/people/${id}`);
    expect(res.status).toBe(200);

    const list = await request(app).get('/api/people');
    expect(list.body).toEqual([]);
  });

  test('DELETE /api/people/:id returns 404 for unknown ID', async () => {
    const res = await request(app).delete('/api/people/aabbccddee11');
    expect(res.status).toBe(404);
  });
});

// ── Notes API ────────────────────────────────────────────────

describe('Notes API', () => {
  let personId;

  beforeEach(async () => {
    const res = await request(app).post('/api/people').send({ name: 'Alice' });
    personId = res.body.id;
  });

  test('GET /api/people/:id/notes returns empty array initially', async () => {
    const res = await request(app).get(`/api/people/${personId}/notes`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/people/:id/notes creates a note', async () => {
    const res = await request(app)
      .post(`/api/people/${personId}/notes`)
      .send({ content: 'Test note', title: 'Meeting', tags: ['weekly'] });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Test note');
    expect(res.body.tags).toEqual(['weekly']);
  });

  test('POST /api/people/:id/notes validates content required', async () => {
    const res = await request(app)
      .post(`/api/people/${personId}/notes`)
      .send({ content: '' });
    expect(res.status).toBe(400);
  });

  test('POST /api/people/:id/notes returns 404 for unknown person', async () => {
    const res = await request(app)
      .post('/api/people/aabbccddee11/notes')
      .send({ content: 'Note' });
    expect(res.status).toBe(404);
  });

  test('PUT /api/people/:id/notes/:noteId updates a note', async () => {
    const create = await request(app)
      .post(`/api/people/${personId}/notes`)
      .send({ content: 'Original' });
    const noteId = create.body.id;

    const res = await request(app)
      .put(`/api/people/${personId}/notes/${noteId}`)
      .send({ content: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Updated');
  });

  test('DELETE /api/people/:id/notes/:noteId removes a note', async () => {
    const create = await request(app)
      .post(`/api/people/${personId}/notes`)
      .send({ content: 'To delete' });
    const noteId = create.body.id;

    const res = await request(app).delete(`/api/people/${personId}/notes/${noteId}`);
    expect(res.status).toBe(200);

    const list = await request(app).get(`/api/people/${personId}/notes`);
    expect(list.body).toEqual([]);
  });

  test('notes are returned newest first', async () => {
    await request(app).post(`/api/people/${personId}/notes`).send({ content: 'First' });
    await request(app).post(`/api/people/${personId}/notes`).send({ content: 'Second' });

    const res = await request(app).get(`/api/people/${personId}/notes`);
    expect(res.body[0].content).toBe('Second');
    expect(res.body[1].content).toBe('First');
  });
});

// ── Questions API ────────────────────────────────────────────

describe('Questions API', () => {
  test('GET /api/questions returns default questions', async () => {
    const res = await request(app).get('/api/questions');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('PUT /api/questions updates questions', async () => {
    const res = await request(app)
      .put('/api/questions')
      .send({ questions: ['New question?'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['New question?']);
  });

  test('PUT /api/questions validates input', async () => {
    const res = await request(app)
      .put('/api/questions')
      .send({ questions: [] });
    expect(res.status).toBe(400);
  });
});

// ── Tags API ─────────────────────────────────────────────────

describe('Tags API', () => {
  test('GET /api/tags returns unique tags across all notes', async () => {
    const p1 = await request(app).post('/api/people').send({ name: 'Alice' });
    const p2 = await request(app).post('/api/people').send({ name: 'Bob' });

    await request(app).post(`/api/people/${p1.body.id}/notes`).send({ content: 'n1', tags: ['weekly', 'planning'] });
    await request(app).post(`/api/people/${p2.body.id}/notes`).send({ content: 'n2', tags: ['weekly', 'retro'] });

    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['planning', 'retro', 'weekly']);
  });
});

// ── Dashboard API ────────────────────────────────────────────

describe('Dashboard API', () => {
  test('GET /api/dashboard returns recent notes', async () => {
    const person = await request(app).post('/api/people').send({ name: 'Alice' });
    await request(app)
      .post(`/api/people/${person.body.id}/notes`)
      .send({ content: 'Recent note' });

    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].personName).toBe('Alice');
  });
});

// ── Version API ──────────────────────────────────────────────

describe('Version API', () => {
  test('GET /api/version returns version string', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body.version).toBeDefined();
  });
});
