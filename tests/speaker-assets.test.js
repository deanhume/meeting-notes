const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assets = require('../scripts/fetch-model');
const { isModelAvailable } = require('../transcription');

describe('speaker model packaging', () => {
  test('checks for speaker weights and preprocessing assets before enabling recording', () => {
    const exists = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    try {
      expect(isModelAvailable({ isPackaged: false })).toBe(true);
      for (const { name } of assets.SPEAKER_MODELS) {
        exists.mockImplementation((file) => !file.includes(name));
        expect(isModelAvailable({ isPackaged: false })).toBe(false);
      }
      exists.mockImplementation((file) => !file.endsWith('preprocessor_config.json'));
      expect(isModelAvailable({ isPackaged: false })).toBe(false);
    } finally {
      exists.mockRestore();
    }
  });

  test.each(['onnx/model_quantized.onnx', 'LICENSE.txt'])('blocks release when speaker %s is missing', (file) => {
    const missing = path.join('wespeaker-voxceleb-resnet34-LM', file);
    const errors = [];
    const exit = jest.fn();
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-release.js'), 'utf8'), {
      __dirname: path.join(__dirname, '..', 'scripts'),
      process: { argv: ['node', 'verify-release.js', 'pre'], env: {}, platform: process.platform, exit },
      console: { log: jest.fn(), error: (message) => errors.push(message) },
      require: (name) => {
        if (name === 'fs') return {
          existsSync: (target) => !target.endsWith(missing),
          statSync: () => ({ size: 100 * 1024 * 1024 }),
        };
        if (name === 'child_process') return { spawnSync: () => ({ status: 0 }) };
        if (name === '@electron/asar') return {};
        if (name === './fetch-model') return assets;
        return require(name);
      },
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join(' ')).toContain(missing);
  });
});
