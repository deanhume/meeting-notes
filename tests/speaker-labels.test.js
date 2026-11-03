const {
  createSpeakerRegistry, speakerForInterval, labelTranscript, stripSpeakerLabels,
} = require('../public/js/speaker-labels');
const { cleanTranscript, finalizeTranscript } = require('../public/js/transcript-clean');
const { summarizeToBullets } = require('../public/js/summarizer');

describe('recording-wide speaker matching', () => {
  test('reuses identities across reordered local slots and resets between recordings', () => {
    const registry = createSpeakerRegistry();
    expect(registry.match([1, 0, 0])).toBe(1);
    expect(registry.match([0, 1, 0])).toBe(2);
    expect(registry.match([0, 0.99, 0.01])).toBe(2);
    expect(registry.match([0.99, 0, 0.01])).toBe(1);
    registry.reset();
    expect(registry.match([0, 1, 0])).toBe(1);
  });

  test('leaves borderline matches and competing identities unknown', () => {
    const registry = createSpeakerRegistry();
    registry.match([1, 0, 0]);
    registry.match([0, 1, 0]);
    expect(registry.match([0.7, 0.7, 0])).toBeNull();
    expect(registry.match([0.55, 0, 0.835])).toBeNull();
    expect(registry.match([1, 0, 0], new Set([1]))).toBeNull();
  });

  test('rejects invalid vectors rather than creating a plausible identity', () => {
    const registry = createSpeakerRegistry();
    expect(() => registry.match([0, 0])).toThrow('Invalid speaker embedding');
    expect(() => registry.match([NaN, 1])).toThrow('Invalid speaker embedding');
    registry.match([1, 0]);
    expect(() => registry.match([1, 0, 0])).toThrow('dimensions changed');
  });
});

describe('timestamp attribution', () => {
  const turns = [
    { start: 0, end: 2, speaker: 1 },
    { start: 2, end: 4, speaker: 2 },
    { start: 4, end: 5, overlap: true },
  ];

  test('matches speakers only when their coverage is sufficient', () => {
    expect(speakerForInterval(0, 2, turns)).toBe('Speaker 1');
    expect(speakerForInterval(2, 4, turns)).toBe('Speaker 2');
    expect(speakerForInterval(1, 3, turns)).toBe('Unknown speaker');
    expect(speakerForInterval(0, 2.2, turns)).toBe('Unknown speaker');
    expect(speakerForInterval(0, 10, turns)).toBe('Overlapping speakers');
    expect(speakerForInterval(5, 6, turns)).toBe('Unknown speaker');
    expect(speakerForInterval(null, 2, turns)).toBe('Unknown speaker');
    expect(speakerForInterval(2, null, turns)).toBe('Unknown speaker');
  });

  test('cleans speech without losing turn labels or inventing attribution for missing timestamps', () => {
    const out = labelTranscript({ chunks: [
      { text: 'Um, ship Friday.', timestamp: [0, 2] },
      { text: 'I will review it.', timestamp: [2, 4] },
      { text: 'Both speaking.', timestamp: [4, 5] },
      { text: 'No timing.', timestamp: [null, null] },
    ] }, turns, cleanTranscript);
    expect(out).toBe('Speaker 1: ship Friday.\nSpeaker 2: I will review it.\nOverlapping speakers: Both speaking.\nUnknown speaker: No timing.');
    expect(labelTranscript({ text: 'Keep my words.' }, [], cleanTranscript))
      .toBe('Unknown speaker: Keep my words.');
    expect(labelTranscript({ text: '' }, [], cleanTranscript)).toBe('');
  });

  test('keeps speakers distinct during finalization and out of summary facts', () => {
    const text = 'Speaker 1: We are going to.\nSpeaker 2: Ship Friday.';
    expect(finalizeTranscript(text)).toBe(text);
    expect(stripSpeakerLabels(text)).toBe('We are going to.\nShip Friday.');
    const labeled = 'Speaker 1: Priya will send the checklist by Friday.\nUnknown speaker: We decided to delay launch.';
    expect(summarizeToBullets(labeled)).toBe(summarizeToBullets(stripSpeakerLabels(labeled)));
    const header = '[Recording started: 2026-11-03T12:00:00.000Z; speaker labels reset]';
    expect(summarizeToBullets(`${header}\n${labeled}`)).toBe(summarizeToBullets(stripSpeakerLabels(labeled)));
    expect(finalizeTranscript(`${header}\n${text}`)).toBe(`${header}\n${text}`);
    expect(finalizeTranscript('[Recording started: incomplete')).toBe('[Recording started: incomplete');
  });
});
