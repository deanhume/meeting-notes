const { getTranscriptFileName, getTranscriptFilePath } = require('../transcript-file');

describe('transcript file naming', () => {
  test('uses note-linked filename when note id is valid', () => {
    expect(getTranscriptFileName('1f68464a72dc')).toBe('transcription_1f68464a72dc.txt');
  });

  test('falls back to timestamp filename when note id is missing/invalid', () => {
    const now = new Date('2026-07-02T07:34:30.076Z');
    expect(getTranscriptFileName('', now)).toBe('transcript_2026-07-02T07-34-30-076Z.txt');
    expect(getTranscriptFileName('../bad', now)).toBe('transcript_2026-07-02T07-34-30-076Z.txt');
  });

  test('builds path inside the transcriptions folder', () => {
    expect(getTranscriptFilePath('/data', '1f68464a72dc')).toBe('/data/transcriptions/transcription_1f68464a72dc.txt');
  });
});
