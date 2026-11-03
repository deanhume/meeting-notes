const fs = require('fs');
const path = require('path');
const vm = require('vm');

function renderer() {
  const context = vm.createContext({ window: {}, Event: class { constructor(type) { this.type = type; } } });
  for (const file of ['transcript-clean.js', 'speaker-labels.js', 'summarizer.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8'), context);
  }
  const nodes = {
    summaryDetail: { value: 'full' },
    summaryEvidence: { checked: true },
    regenerateSummary: { disabled: true },
    noteContentInput: { value: 'My own notes.\n\n', dispatchEvent: () => {} }
  };
  context.document = { getElementById: (id) => nodes[id] };
  return { context, nodes };
}

describe('recording summary integration', () => {
  test('loads cleanup before summarisation in the actual page', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    expect(html.indexOf('src="/js/transcript-clean.js"')).toBeLessThanOrEqual(html.indexOf('src="/js/summarizer.js"'));
    expect(html).toContain('id="summaryDetail"');
    expect(html).toContain('id="summaryEvidence" checked');
  });

  test('reads unfiltered source text and persists the supporting passages in the note text', async () => {
    const { context, nodes } = renderer();
    let readOptions;
    context.window.electronAPI = {
      transcriptRead: async (options) => {
        readOptions = options;
        return 'Can we launch Friday?\nNo.\nPriya will send the checklist by Thursday.';
      }
    };
    expect(await context.refreshSummaryFromFile()).toBe(true);
    expect(readOptions.raw).toBe(true);
    expect(nodes.noteContentInput.value).toContain('My own notes.');
    expect(nodes.noteContentInput.value).toContain('Can we launch Friday? No.');
    expect(nodes.noteContentInput.value).toContain('- [S2] No.');
    expect(nodes.noteContentInput.value).toContain('Owner: Priya. Due: Thursday.');
  });

  test('replaces its unedited summary block rather than duplicating it', () => {
    const { context, nodes } = renderer();
    context.updateLiveSummary('Sarah will review the release by Friday.');
    context.updateLiveSummary('Sarah will review the release by Friday.\nWho owns the deployment?');
    expect(nodes.noteContentInput.value.split('Meeting Summary')).toHaveLength(2);
    expect(nodes.noteContentInput.value).toContain('Who owns the deployment?');
  });

  test('supports compact output without dropping actions or including the evidence appendix', () => {
    const { context, nodes } = renderer();
    nodes.summaryDetail.value = 'brief';
    nodes.summaryEvidence.checked = false;
    const transcript = Array.from({ length: 9 }, (_, i) => `Action item: review ticket ${i + 1}.`).join('\n');
    context.updateLiveSummary(transcript);
    for (let i = 1; i <= 9; i += 1) expect(nodes.noteContentInput.value).toContain(`review ticket ${i}.`);
    expect(nodes.noteContentInput.value).not.toContain('Supporting transcript passages');
  });

  test('regenerates with changed detail options and clears cached transcripts between notes', () => {
    const { context, nodes } = renderer();
    context.updateLiveSummary('Priya will send the checklist by Friday.');
    expect(nodes.regenerateSummary.disabled).toBe(false);
    nodes.summaryEvidence.checked = false;
    context.regenerateRecordingSummary();
    expect(nodes.noteContentInput.value).not.toContain('Supporting transcript passages');
    context.resetRecordingSummary();
    expect(nodes.regenerateSummary.disabled).toBe(true);
    nodes.noteContentInput.value = '';
    context.regenerateRecordingSummary();
    expect(nodes.noteContentInput.value).toBe('');
  });

  test('does not corrupt literal replacement tokens when updating a summary', () => {
    const { context, nodes } = renderer();
    context.updateLiveSummary('We agreed to approve the pilot.');
    context.updateLiveSummary('We agreed the replacement text is $& and $1.');
    expect(nodes.noteContentInput.value).toContain('replacement text is $& and $1.');
    expect(nodes.noteContentInput.value.split('Meeting Summary')).toHaveLength(2);
  });

  test('preserves existing notes and leaves regeneration available when the result is too long', () => {
    const { context, nodes } = renderer();
    const original = 'x'.repeat(49990);
    nodes.noteContentInput.value = original;
    expect(() => context.updateLiveSummary('Priya will send the checklist by Friday.')).toThrow(/50,000/);
    expect(nodes.noteContentInput.value).toBe(original);
    expect(nodes.regenerateSummary.disabled).toBe(false);
  });

  test('blocks the pending modal close after a finalisation error, but permits an explicit later save', async () => {
    const { context } = renderer();
    vm.runInContext('isTranscribing = true;', context);
    const pending = context.finalizeRecordingIfActive();
    vm.runInContext('recordingFinalizationFailed = true; isTranscribing = false; resolveStopWaiters();', context);
    expect(await pending).toBe(false);
    expect(await context.finalizeRecordingIfActive()).toBe(true);
  });
});

describe('recording chunk boundaries', () => {
  function recording(seconds) {
    const { context } = renderer();
    const pcm = new Float32Array(Math.round(seconds * 16000)).fill(0.25);
    context.Blob = Blob;
    context.blobToPcm16kMono = jest.fn(async () => pcm);
    context.window.cleanTranscript = context.cleanTranscript;
    context.window.rendererTranscription = { transcribe: jest.fn(async () => 'Keep the whole sentence.') };
    context.window.electronAPI = { transcriptAppend: jest.fn(async () => true) };
    vm.runInContext('recordedChunks = [new Blob(["audio"])];', context);
    return { context, pcm };
  }

  test('waits for 30 seconds of context plus the live-edge guard', async () => {
    const { context } = recording(30.5);
    await context.transcribeLiveChunk(false);
    expect(context.window.rendererTranscription.transcribe).not.toHaveBeenCalled();
    expect(vm.runInContext('processedSamples', context)).toBe(0);
  });

  test('selects a quiet boundary between 20 and 30 seconds, ignoring earlier pauses', async () => {
    const { context, pcm } = recording(31);
    pcm.fill(0, 10 * 16000, 11 * 16000);
    pcm.fill(0.01, 25 * 16000, 26 * 16000);
    await context.transcribeLiveChunk(false);
    const chunk = context.window.rendererTranscription.transcribe.mock.calls[0][0];
    expect(chunk.length).toBeGreaterThanOrEqual(25 * 16000);
    expect(chunk.length).toBeLessThan(26 * 16000);
    expect(vm.runInContext('processedSamples', context)).toBe(chunk.length);
    expect(context.window.electronAPI.transcriptAppend).toHaveBeenCalledWith('Keep the whole sentence.');
  });

  test('caps a delayed live chunk at 30 seconds and consumes subsequent audio without gaps', async () => {
    const { context, pcm } = recording(75);
    pcm.fill(0, 29 * 16000, 30 * 16000);
    pcm.fill(0, 58 * 16000, 59 * 16000);
    await context.transcribeLiveChunk(false);
    await context.transcribeLiveChunk(false);
    await context.transcribeLiveChunk(true);
    const chunks = context.window.rendererTranscription.transcribe.mock.calls.map(([chunk]) => chunk);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBeLessThanOrEqual(30 * 16000);
    expect(chunks[1].length).toBeLessThanOrEqual(30 * 16000);
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(pcm.length);
    const combined = new Float32Array(pcm.length);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    expect(Buffer.from(combined.buffer).equals(Buffer.from(pcm.buffer))).toBe(true);
  });

  test.each([0.5, 12, 31])('flushes all remaining audio at Stop, including a %ss recording', async (seconds) => {
    const { context, pcm } = recording(seconds);
    await context.transcribeLiveChunk(true);
    const calls = context.window.rendererTranscription.transcribe.mock.calls;
    expect(calls).toHaveLength(1);
    expect(Buffer.from(calls[0][0].buffer).equals(Buffer.from(pcm.buffer))).toBe(true);
    expect(vm.runInContext('processedSamples', context)).toBe(pcm.length);
  });

  test('preserves labels when appending and excludes them from the word count', async () => {
    const { context } = recording(12);
    context.window.rendererTranscription.transcribe.mockResolvedValue('Speaker 1: Keep this.\nSpeaker 2: Ship Friday.');
    await context.transcribeLiveChunk(true);
    expect(context.window.electronAPI.transcriptAppend)
      .toHaveBeenCalledWith('Speaker 1: Keep this.\nSpeaker 2: Ship Friday.');
    expect(vm.runInContext('liveWordCount', context)).toBe(4);
  });

  test.each(['inference', 'append'])('does not consume audio after a final %s failure', async (stage) => {
    const { context } = recording(12);
    if (stage === 'inference') {
      context.window.rendererTranscription.transcribe.mockRejectedValue(new Error('Model failed.'));
    } else {
      context.window.electronAPI.transcriptAppend.mockResolvedValue(false);
    }
    await expect(context.transcribeLiveChunk(true)).rejects.toThrow();
    expect(vm.runInContext('processedSamples', context)).toBe(0);
    expect(vm.runInContext('liveBusy', context)).toBe(false);
  });
});

describe('transcript IPC source contract', () => {
  test('forwards raw-read options through the preload bridge', () => {
    let bridge;
    let invocation;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8'), {
      require: () => ({
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: { invoke: (...args) => { invocation = args; } }
      })
    });
    bridge.transcriptRead({ raw: true });
    expect(invocation[0]).toBe('transcript-read');
    expect(invocation[1].raw).toBe(true);
  });

  test('returns original stored text on request while preserving the finalised default', () => {
    const handlers = new Map();
    const raw = 'Yeah.\nCan we launch Friday?\nNo.\n';
    const transcription = require('../transcription');
    const dependencies = {
      electron: {
        app: { getPath: () => 'C:\\synthetic', whenReady: () => new Promise(() => {}), on: () => {} },
        ipcMain: { handle: (name, callback) => handlers.set(name, callback) }
      },
      path,
      fs: { existsSync: () => true, readFileSync: () => raw, appendFileSync: jest.fn() },
      express: () => {},
      'electron-updater': { autoUpdater: {} },
      './shared': { safeLoadJSON: () => ({ dataLocation: 'C:\\synthetic' }) },
      './transcription': transcription,
      './transcript-file': { getTranscriptFilePath: () => 'C:\\synthetic\\transcriptions\\transcription_123456789abc.txt' }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), {
      require: (name) => {
        if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
        return dependencies[name];
      }
    });
    handlers.get('transcript-start')({}, '123456789abc');
    expect(dependencies.fs.appendFileSync.mock.calls[0][1]).toMatch(/speaker labels reset\]/);
    expect(handlers.get('transcript-read')({}, { raw: true })).toBe(raw);
    expect(handlers.get('transcript-read')({})).toBe(transcription.finalizeTranscript(raw));
  });
});
