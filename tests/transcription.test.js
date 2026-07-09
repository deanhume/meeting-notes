const { cleanTranscript, finalizeTranscript } = require('../transcription');

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

describe('finalizeTranscript', () => {
  test('returns empty string for empty/blank input', () => {
    expect(finalizeTranscript('')).toBe('');
    expect(finalizeTranscript(null)).toBe('');
    expect(finalizeTranscript(undefined)).toBe('');
  });

  test('drops backchannel-only lines', () => {
    const input = [
      'Yeah.',
      'We decided to cut the feature from the game.',
      'Exactly right.',
      'Okay, cool, thanks.',
      'The platform team lost a lot of people this week.',
      'Bye.',
    ].join('\n');
    const out = finalizeTranscript(input);
    expect(out).toMatch(/cut the feature/);
    expect(out).toMatch(/platform team lost/);
    expect(out).not.toMatch(/Exactly right/);
    expect(out).not.toMatch(/^Yeah\.$/m);
    expect(out).not.toMatch(/^Bye\.$/m);
  });

  test('re-joins a fragment split across chunk boundaries', () => {
    // transcript-append force-terminates each chunk with a ".", so one utterance
    // split across audio windows arrives as two lines ending on a connective.
    const input = [
      "We're not going with any video, I can't.",
      'risk this.',
    ].join('\n');
    const out = finalizeTranscript(input);
    expect(out).toContain("I can't risk this.");
    expect(out.split('\n').length).toBe(1);
  });

  test('merges a fragment ending on a trailing comma', () => {
    const input = ['We lost three studios in Europe,', 'which changes the game a lot.'].join('\n');
    const out = finalizeTranscript(input);
    expect(out).toContain('We lost three studios in Europe which changes the game a lot.');
  });

  test('does not merge two complete sentences', () => {
    const input = ['We shipped the release today.', 'The team is very happy about it.'].join('\n');
    expect(finalizeTranscript(input).split('\n')).toEqual([
      'We shipped the release today.',
      'The team is very happy about it.',
    ]);
  });

  test('never chains more than two fragments into one sentence', () => {
    // Real appended chunks always end with ".", so a run of incomplete fragments
    // must not all collapse into one sprawling sentence.
    const input = ['We are going to.', 'And then we will.', 'Ship the product tomorrow.'].join('\n');
    const out = finalizeTranscript(input);
    const lines = out.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('We are going to And then we will.');
    expect(lines[1]).toBe('Ship the product tomorrow.');
  });
});
