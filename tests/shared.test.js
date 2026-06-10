const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  atomicWriteFile,
  validateId,
  safeLoadJSON,
  sanitizeString,
  generateId,
  validatePersonData,
  validateNoteData,
  validateQuestionsData,
} = require('../shared');

// ── Helper: create a temp directory for file-based tests ──────

let tmpDir;
let consoleErrorSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-notes-test-'));
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── validateId ───────────────────────────────────────────────

describe('validateId', () => {
  test('accepts valid 12-char hex IDs', () => {
    expect(validateId('abcdef123456')).toBe(true);
  });

  test('accepts IDs between 8 and 20 chars', () => {
    expect(validateId('abcd1234')).toBe(true);
    expect(validateId('a'.repeat(20))).toBe(true);
  });

  test('rejects null/undefined/empty', () => {
    expect(validateId(null)).toBe(false);
    expect(validateId(undefined)).toBe(false);
    expect(validateId('')).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(validateId(123)).toBe(false);
    expect(validateId({})).toBe(false);
  });

  test('rejects IDs that are too short or too long', () => {
    expect(validateId('abc')).toBe(false);
    expect(validateId('a'.repeat(21))).toBe(false);
  });

  test('rejects IDs with uppercase or special chars', () => {
    expect(validateId('ABCDEF123456')).toBe(false);
    expect(validateId('abcdef-12345')).toBe(false);
  });
});

// ── sanitizeString ───────────────────────────────────────────

describe('sanitizeString', () => {
  test('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  test('truncates to maxLength', () => {
    expect(sanitizeString('abcdef', 3)).toBe('abc');
  });

  test('returns empty string for non-string inputs', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
    expect(sanitizeString(123)).toBe('');
  });

  test('uses default maxLength of 1000', () => {
    const long = 'x'.repeat(1500);
    expect(sanitizeString(long).length).toBe(1000);
  });
});

// ── generateId ───────────────────────────────────────────────

describe('generateId', () => {
  test('returns a 12-character hex string', () => {
    const id = generateId();
    expect(id).toHaveLength(12);
    expect(/^[a-f0-9]{12}$/.test(id)).toBe(true);
  });

  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

// ── atomicWriteFile ──────────────────────────────────────────

describe('atomicWriteFile', () => {
  test('writes content to file', () => {
    const file = path.join(tmpDir, 'test.json');
    atomicWriteFile(file, '{"hello":"world"}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"hello":"world"}');
  });

  test('overwrites existing file', () => {
    const file = path.join(tmpDir, 'test.json');
    fs.writeFileSync(file, 'old');
    atomicWriteFile(file, 'new');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });

  test('does not leave temp files on success', () => {
    const file = path.join(tmpDir, 'test.json');
    atomicWriteFile(file, 'data');
    const files = fs.readdirSync(tmpDir);
    expect(files).toEqual(['test.json']);
  });
});

// ── safeLoadJSON ─────────────────────────────────────────────

describe('safeLoadJSON', () => {
  test('loads valid JSON file', () => {
    const file = path.join(tmpDir, 'data.json');
    fs.writeFileSync(file, JSON.stringify({ a: 1 }));
    expect(safeLoadJSON(file)).toEqual({ a: 1 });
  });

  test('returns defaultValue for missing file', () => {
    expect(safeLoadJSON('/nonexistent/file.json', [])).toEqual([]);
  });

  test('returns defaultValue for invalid JSON', () => {
    const file = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(file, 'not json');
    expect(safeLoadJSON(file, 'fallback')).toBe('fallback');
  });

  test('returns null as default when no defaultValue provided', () => {
    expect(safeLoadJSON('/nonexistent')).toBeNull();
  });
});

// ── validatePersonData ───────────────────────────────────────

describe('validatePersonData', () => {
  test('returns no errors for valid data', () => {
    expect(validatePersonData({ name: 'Alice', role: 'Engineer', team: 'Platform' })).toEqual([]);
  });

  test('requires name', () => {
    const errors = validatePersonData({ name: '' });
    expect(errors).toContain('Name is required');
  });

  test('rejects name over 200 chars', () => {
    const errors = validatePersonData({ name: 'x'.repeat(201) });
    expect(errors.some(e => e.includes('200 characters'))).toBe(true);
  });

  test('rejects role over 200 chars', () => {
    const errors = validatePersonData({ name: 'Alice', role: 'x'.repeat(201) });
    expect(errors.some(e => e.includes('Role'))).toBe(true);
  });

  test('rejects team over 200 chars', () => {
    const errors = validatePersonData({ name: 'Alice', team: 'x'.repeat(201) });
    expect(errors.some(e => e.includes('Team'))).toBe(true);
  });
});

// ── validateNoteData ─────────────────────────────────────────

describe('validateNoteData', () => {
  test('returns no errors for valid note', () => {
    expect(validateNoteData({ content: 'Hello', title: 'Test', tags: ['tag1'] })).toEqual([]);
  });

  test('requires content', () => {
    const errors = validateNoteData({ content: '' });
    expect(errors).toContain('Content is required');
  });

  test('rejects content over 50000 chars', () => {
    const errors = validateNoteData({ content: 'x'.repeat(50001) });
    expect(errors.some(e => e.includes('50,000'))).toBe(true);
  });

  test('rejects title over 500 chars', () => {
    const errors = validateNoteData({ content: 'hi', title: 'x'.repeat(501) });
    expect(errors.some(e => e.includes('Title'))).toBe(true);
  });

  test('rejects non-array tags', () => {
    const errors = validateNoteData({ content: 'hi', tags: 'not-array' });
    expect(errors).toContain('Tags must be an array');
  });

  test('rejects more than 20 tags', () => {
    const errors = validateNoteData({ content: 'hi', tags: Array(21).fill('tag') });
    expect(errors.some(e => e.includes('Maximum 20'))).toBe(true);
  });

  test('rejects empty string tags', () => {
    const errors = validateNoteData({ content: 'hi', tags: [''] });
    expect(errors.some(e => e.includes('non-empty string'))).toBe(true);
  });
});

// ── validateQuestionsData ────────────────────────────────────

describe('validateQuestionsData', () => {
  test('returns no errors for valid questions', () => {
    expect(validateQuestionsData(['Question 1?', 'Question 2?'])).toEqual([]);
  });

  test('rejects non-array input', () => {
    const errors = validateQuestionsData('not array');
    expect(errors).toContain('Questions must be an array');
  });

  test('rejects empty array', () => {
    const errors = validateQuestionsData([]);
    expect(errors).toContain('At least one question is required');
  });

  test('rejects more than 500 questions', () => {
    const errors = validateQuestionsData(Array(501).fill('q'));
    expect(errors.some(e => e.includes('max 500'))).toBe(true);
  });

  test('rejects questions over 1000 chars', () => {
    const errors = validateQuestionsData(['x'.repeat(1001)]);
    expect(errors.some(e => e.includes('1,000 characters'))).toBe(true);
  });
});
