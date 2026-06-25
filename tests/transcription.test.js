const { cleanTranscript } = require('../transcription');

// cleanTranscript is pure text processing — no native Whisper addon is loaded,
// so these tests run anywhere the rest of the suite does.

describe('cleanTranscript', () => {
  test('returns empty string for empty/blank input', () => {
    expect(cleanTranscript('')).toBe('');
    expect(cleanTranscript(null)).toBe('');
    expect(cleanTranscript(undefined)).toBe('');
  });

  test('removes standalone filler/hesitation words', () => {
    const out = cleanTranscript('Um, so uh I think erm we should hmm ship it.');
    expect(out.toLowerCase()).not.toMatch(/\b(um|uh|erm|hmm)\b/);
    expect(out).toMatch(/we should/i);
    expect(out).toMatch(/ship it\./);
  });

  test('strips bracketed and parenthesised non-speech markers', () => {
    const out = cleanTranscript('[BLANK_AUDIO] Hello there (background noise) friend.');
    expect(out).not.toMatch(/BLANK_AUDIO/);
    expect(out).not.toMatch(/background noise/);
    expect(out).toMatch(/Hello there/);
    expect(out).toMatch(/friend\./);
  });

  test('collapses immediately repeated words', () => {
    const out = cleanTranscript('The the the meeting is is done.');
    expect(out).toBe('The meeting is done.');
  });

  test('collapses repeated short phrases (hallucination loops)', () => {
    const out = cleanTranscript('Thank you thank you thank you.');
    expect(out).toBe('Thank you.');
  });

  test('puts each sentence on its own line', () => {
    const out = cleanTranscript('First sentence. Second sentence! Third one?');
    expect(out.split('\n')).toEqual([
      'First sentence.',
      'Second sentence!',
      'Third one?',
    ]);
  });

  test('keeps an unpunctuated trailing remainder as its own line', () => {
    const out = cleanTranscript('Done here. and more to come');
    const lines = out.split('\n');
    expect(lines[0]).toBe('Done here.');
    expect(lines[1]).toMatch(/and more to come/);
  });

  test('normalises whitespace and spacing before punctuation', () => {
    const out = cleanTranscript('Hello   world , this  is   fine .');
    expect(out).toBe('Hello world, this is fine.');
  });

  test('does not mangle ordinary repeated-but-distinct content', () => {
    const out = cleanTranscript('We shipped the API and the UI.');
    expect(out).toBe('We shipped the API and the UI.');
  });
});
