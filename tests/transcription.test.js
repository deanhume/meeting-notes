const {
  cleanTranscript,
  finalizeTranscript,
  recommendModel,
  pickModelKey,
  computeThreads,
  MODEL_ORDER,
} = require('../transcription');

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

describe('recommendModel', () => {
  test('picks tiny for low core counts', () => {
    expect(recommendModel(1)).toBe('tiny');
    expect(recommendModel(4)).toBe('tiny');
  });

  test('picks base for mid core counts', () => {
    expect(recommendModel(5)).toBe('base');
    expect(recommendModel(8)).toBe('base');
  });

  test('picks small for high core counts', () => {
    expect(recommendModel(12)).toBe('small');
    expect(recommendModel(24)).toBe('small');
  });
});

describe('pickModelKey', () => {
  test('returns null when nothing is installed', () => {
    expect(pickModelKey([], 'auto', 8)).toBeNull();
    expect(pickModelKey(null, 'base', 8)).toBeNull();
  });

  test('honours an explicit installed choice', () => {
    expect(pickModelKey(['tiny', 'base', 'small'], 'tiny', 24)).toBe('tiny');
    expect(pickModelKey(['tiny', 'base', 'small'], 'small', 2)).toBe('small');
  });

  test('auto targets the recommended tier when installed', () => {
    expect(pickModelKey(['tiny', 'base', 'small'], 'auto', 24)).toBe('small');
    expect(pickModelKey(['tiny', 'base', 'small'], 'auto', 8)).toBe('base');
    expect(pickModelKey(['tiny', 'base', 'small'], 'auto', 2)).toBe('tiny');
  });

  test('auto falls back to the closest installed model at or below the target', () => {
    // 24 cores wants small, but only base/tiny installed → base.
    expect(pickModelKey(['tiny', 'base'], 'auto', 24)).toBe('base');
    // 8 cores wants base, only tiny installed → tiny.
    expect(pickModelKey(['tiny'], 'auto', 8)).toBe('tiny');
  });

  test('an uninstalled explicit choice falls back like auto', () => {
    // small requested but not installed → closest at/below (base).
    expect(pickModelKey(['tiny', 'base'], 'small', 8)).toBe('base');
  });

  test('falls back upward when nothing at/below the target is installed', () => {
    // tiny requested/target but only small installed → small.
    expect(pickModelKey(['small'], 'auto', 2)).toBe('small');
  });
});

describe('computeThreads', () => {
  const cores = require('os').cpus().length;

  test('clamps an explicit thread count to the core count', () => {
    expect(computeThreads(2)).toBe(2);
    expect(computeThreads(9999)).toBe(cores);
  });

  test('falls back to the default for invalid or zero values', () => {
    const def = computeThreads(0);
    expect(computeThreads('nonsense')).toBe(def);
    expect(computeThreads(-1)).toBe(def);
    expect(computeThreads(null)).toBe(def);
    expect(def).toBeGreaterThanOrEqual(1);
    expect(def).toBeLessThanOrEqual(cores);
  });
});

describe('MODEL_ORDER', () => {
  test('is ordered lightest to heaviest', () => {
    expect(MODEL_ORDER).toEqual(['tiny', 'base', 'small']);
  });
});
