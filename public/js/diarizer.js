import { AutoModel, AutoFeatureExtractor } from '/vendor/transformers/transformers.js';

const SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = 10 * SAMPLE_RATE;
const STEP_SAMPLES = 8 * SAMPLE_RATE;
const registry = window.speakerLabelTools.createSpeakerRegistry();
let loading = null;

function load() {
  if (!loading) {
    loading = (async () => {
      // WASM also works on machines without WebGPU and avoids competing with Whisper's GPU.
      const segmentation = await AutoModel.from_pretrained('pyannote-segmentation-3.0', {
        device: 'wasm', dtype: 'q8',
      });
      try {
        const segmentProcessor = await AutoFeatureExtractor.from_pretrained('pyannote-segmentation-3.0');
        const embedding = await AutoModel.from_pretrained('wespeaker-voxceleb-resnet34-LM', {
          device: 'wasm', dtype: 'q8',
        });
        try {
          const embedProcessor = await AutoFeatureExtractor.from_pretrained('wespeaker-voxceleb-resnet34-LM');
          return { segmentation, segmentProcessor, embedding, embedProcessor };
        } catch (error) {
          await embedding.dispose();
          throw error;
        }
      } catch (error) {
        await segmentation.dispose();
        throw error;
      }
    })().catch((error) => { loading = null; throw error; });
  }
  return loading;
}

async function diarize(pcm) {
  const { segmentation, segmentProcessor, embedding, embedProcessor } = await load();
  const turns = [];
  for (let core = 0; core < pcm.length; core += STEP_SAMPLES) {
    const offset = Math.max(0, core - SAMPLE_RATE);
    const windowPcm = new Float32Array(WINDOW_SAMPLES);
    windowPcm.set(pcm.subarray(offset, Math.min(pcm.length, offset + WINDOW_SAMPLES)));
    const { logits } = await segmentation(await segmentProcessor(windowPcm));
    const local = segmentProcessor.post_process_speaker_diarization(logits, windowPcm.length)[0];
    const speakers = new Map();
    const used = new Set();
    // Local slot numbers are not identities. Match a clean voice sample for each
    // slot to recording-wide embeddings before retaining any of the window.
    for (const id of [1, 2, 3]) {
      const pieces = local.filter((turn) => turn.id === id && turn.confidence >= 0.7 &&
        turn.end - turn.start >= 0.3 && turn.start * SAMPLE_RATE < pcm.length - offset)
        .map((turn) => windowPcm.subarray(
          Math.ceil(turn.start * SAMPLE_RATE),
          Math.min(pcm.length - offset, Math.floor(turn.end * SAMPLE_RATE))));
      const count = Math.min(6 * SAMPLE_RATE, pieces.reduce((sum, piece) => sum + piece.length, 0));
      if (count < SAMPLE_RATE) continue;
      const sample = new Float32Array(count);
      let cursor = 0;
      for (const piece of pieces) {
        const part = piece.subarray(0, count - cursor);
        sample.set(part, cursor);
        cursor += part.length;
        if (cursor === count) break;
      }
      const { last_hidden_state } = await embedding(await embedProcessor(sample));
      const speaker = registry.match(last_hidden_state.data, used);
      speakers.set(id, speaker);
      if (speaker) used.add(speaker);
    }
    const coreStart = core / SAMPLE_RATE;
    const coreEnd = Math.min(pcm.length, core + STEP_SAMPLES) / SAMPLE_RATE;
    for (const turn of local) {
      const start = Math.max(coreStart, offset / SAMPLE_RATE + turn.start);
      const end = Math.min(coreEnd, offset / SAMPLE_RATE + turn.end);
      if (end <= start) continue;
      turns.push({
        start, end,
        speaker: turn.confidence >= 0.7 ? speakers.get(turn.id) || null : null,
        overlap: turn.confidence >= 0.7 && turn.id >= 4,
      });
    }
  }
  return turns;
}

export const speakerDiarization = { diarize, warmup: load, reset: () => registry.reset() };
