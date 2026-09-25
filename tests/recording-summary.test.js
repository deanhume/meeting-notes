const fs = require('fs');
const path = require('path');
const vm = require('vm');

function renderer() {
  const context = vm.createContext({ window: {}, Event: class { constructor(type) { this.type = type; } } });
  for (const file of ['transcript-clean.js', 'summarizer.js', 'app.js']) {
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
      fs: { existsSync: () => true, readFileSync: () => raw },
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
    expect(handlers.get('transcript-read')({}, { raw: true })).toBe(raw);
    expect(handlers.get('transcript-read')({})).toBe(transcription.finalizeTranscript(raw));
  });
});
