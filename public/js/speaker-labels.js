/* Recording-local speaker matching and conservative timestamp attribution.
 * Thresholds are provisional until evaluated against real meeting recordings.
 */
const SPEAKER_PREFIX = /^(?:Speaker \d+|Unknown speaker|Overlapping speakers):\s*/;

function normalizeEmbedding(values) {
  const norm = Math.hypot(...values);
  if (!values.length || !Number.isFinite(norm) || norm === 0) {
    throw new Error('Invalid speaker embedding.');
  }
  return Float32Array.from(values, (value) => value / norm);
}

function createSpeakerRegistry() {
  let voices = [];
  return {
    reset() { voices = []; },
    match(values, excluded = new Set()) {
      const embedding = normalizeEmbedding(values);
      if (voices.some((voice) => voice.length !== embedding.length)) {
        throw new Error('Speaker embedding dimensions changed.');
      }
      const scores = voices.map((voice, index) => ({
        id: index + 1,
        score: voice.reduce((sum, value, i) => sum + value * embedding[i], 0),
      })).sort((a, b) => b.score - a.score);
      const best = scores[0];
      if (best && best.score >= 0.65 &&
          best.score - (scores[1]?.score ?? -1) >= 0.08 && !excluded.has(best.id)) {
        voices[best.id - 1] = normalizeEmbedding(voices[best.id - 1].map(
          (value, i) => value * 0.9 + embedding[i] * 0.1));
        return best.id;
      }
      if ((!best || best.score < 0.45) && voices.length < 20) {
        voices.push(embedding);
        return voices.length;
      }
      return null;
    },
  };
}

function speakerForInterval(start, end, turns) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'Unknown speaker';
  const duration = end - start;
  const coverage = new Map();
  for (const turn of turns) {
    const overlap = Math.max(0, Math.min(end, turn.end) - Math.max(start, turn.start));
    if (!overlap) continue;
    const label = turn.overlap ? 'Overlapping speakers'
      : turn.speaker ? `Speaker ${turn.speaker}` : 'Unknown speaker';
    coverage.set(label, (coverage.get(label) || 0) + overlap);
  }
  // Even brief simultaneous speech makes exclusive attribution unsafe.
  if ((coverage.get('Overlapping speakers') || 0) >= Math.min(0.1, duration * 0.2)) {
    return 'Overlapping speakers';
  }
  const ranked = [...coverage].sort((a, b) => b[1] - a[1]);
  if (ranked.filter(([label, amount]) => label.startsWith('Speaker ') && amount >= 0.1).length > 1) {
    return 'Unknown speaker';
  }
  return ranked[0]?.[1] >= duration * 0.75 ? ranked[0][0] : 'Unknown speaker';
}

function labelTranscript(result, turns, clean) {
  if (!Array.isArray(result.chunks) || !result.chunks.length) {
    const text = clean(result.text || '');
    return text ? `Unknown speaker: ${text.replace(/\n/g, ' ')}` : '';
  }
  const lines = [];
  for (const chunk of result.chunks) {
    const text = clean(chunk.text || '').replace(/\n/g, ' ');
    if (!text) continue;
    const [start, end] = chunk.timestamp || [];
    const label = speakerForInterval(start, end, turns);
    if (lines.length && lines[lines.length - 1].label === label) {
      lines[lines.length - 1].text += ` ${text}`;
    } else {
      lines.push({ label, text });
    }
  }
  return lines.map(({ label, text }) => `${label}: ${text}`).join('\n');
}

function stripSpeakerLabels(text) {
  return text.split(/\r?\n/).map((line) => line.replace(SPEAKER_PREFIX, '')).join('\n');
}

const speakerLabelTools = { createSpeakerRegistry, speakerForInterval, labelTranscript, stripSpeakerLabels };
if (typeof module !== 'undefined' && module.exports) module.exports = speakerLabelTools;
if (typeof window !== 'undefined') window.speakerLabelTools = speakerLabelTools;
