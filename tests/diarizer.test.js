const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tools = require('../public/js/speaker-labels');

function engine(windows) {
  let next = 0;
  const segmentation = Object.assign(jest.fn(async () => ({ logits: next++ })), { dispose: jest.fn() });
  const embedding = Object.assign(jest.fn(async (audio) => ({
    last_hidden_state: { data: audio[0] === 1 ? [1, 0] : [0, 1] },
  })), { dispose: jest.fn() });
  const segmentProcessor = Object.assign(jest.fn(async (audio) => audio), {
    post_process_speaker_diarization: (index) => [windows[index]],
  });
  const AutoModel = { from_pretrained: jest.fn(async (name) =>
    name.startsWith('pyannote') ? segmentation : embedding) };
  const AutoFeatureExtractor = { from_pretrained: jest.fn(async (name) =>
    name.startsWith('pyannote') ? segmentProcessor : (audio) => audio) };
  const context = vm.createContext({ AutoModel, AutoFeatureExtractor, window: { speakerLabelTools: tools } });
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'diarizer.js'), 'utf8');
  vm.runInContext(source.replace(/^import .*;\r?\n/m, '').replace('export const speakerDiarization', 'var speakerDiarization'), context);
  return { api: context.speakerDiarization, segmentation, embedding, AutoModel };
}

describe('windowed diarization', () => {
  test('matches reordered local slots across windows and chunks without overlapping output time ranges', async () => {
    const { api, segmentation } = engine([
      [{ id: 1, start: 0, end: 4, confidence: 0.9 }, { id: 2, start: 4, end: 10, confidence: 0.9 }],
      [{ id: 3, start: 1, end: 9, confidence: 0.9 }],
      [{ id: 2, start: 0, end: 2, confidence: 0.9 }],
    ]);
    const pcm = new Float32Array(16 * 16000).fill(2);
    pcm.fill(1, 0, 4 * 16000);
    const turns = await api.diarize(pcm);
    expect(turns.map(({ start, end, speaker }) => [start, end, speaker]))
      .toEqual([[0, 4, 1], [4, 8, 2], [8, 16, 2]]);
    expect(segmentation.mock.calls.every(([audio]) => audio.length === 10 * 16000)).toBe(true);
    expect((await api.diarize(new Float32Array(2 * 16000).fill(1)))[0].speaker).toBe(1);
  });

  test('does not embed silence, overlap, low-confidence turns or very short speech', async () => {
    const { api, embedding } = engine([[
      { id: 0, start: 0, end: 1, confidence: 0.9 },
      { id: 4, start: 1, end: 2, confidence: 0.9 },
      { id: 1, start: 2, end: 3, confidence: 0.4 },
      { id: 2, start: 3, end: 3.2, confidence: 0.9 },
      { id: 3, start: 5, end: 10, confidence: 0.9 },
    ]]);
    const turns = await api.diarize(new Float32Array(4 * 16000).fill(1));
    expect(embedding).not.toHaveBeenCalled();
    expect(turns.every((turn) => turn.speaker === null)).toBe(true);
    expect(turns[1].overlap).toBe(true);
    expect(turns.at(-1).end).toBeLessThanOrEqual(4);
  });

  test('retries failed initialization and releases the partially loaded model', async () => {
    const { api, segmentation, AutoModel } = engine([]);
    AutoModel.from_pretrained.mockImplementationOnce(async () => segmentation)
      .mockRejectedValueOnce(new Error('Missing speaker model.'));
    await expect(api.warmup()).rejects.toThrow('Missing speaker model.');
    expect(segmentation.dispose).toHaveBeenCalledTimes(1);
    await expect(api.warmup()).resolves.toBeDefined();
  });
});
