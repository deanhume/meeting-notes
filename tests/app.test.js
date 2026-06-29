const { getUpdateStatusViewModel } = require('../public/js/app');

describe('getUpdateStatusViewModel', () => {
  test('disables update checks outside the desktop app', () => {
    expect(getUpdateStatusViewModel(null, false)).toEqual({
      buttonText: 'Check for updates',
      buttonDisabled: true,
      statusText: 'Update checks are only available in the desktop app.'
    });
  });

  test('shows checking state while update detection is running', () => {
    expect(getUpdateStatusViewModel({ state: 'checking' }, true)).toEqual({
      buttonText: 'Checking…',
      buttonDisabled: true,
      statusText: 'Checking for updates…'
    });
  });

  test('shows background download messaging while update is downloading', () => {
    expect(getUpdateStatusViewModel({
      state: 'downloading',
      message: 'Downloading version 1.2.2 in the background. You can continue working.'
    }, true)).toEqual({
      buttonText: 'Downloading…',
      buttonDisabled: true,
      statusText: 'Downloading version 1.2.2 in the background. You can continue working.'
    });
  });

  test('falls back to the default action when idle', () => {
    expect(getUpdateStatusViewModel({ state: 'idle', message: '' }, true)).toEqual({
      buttonText: 'Check for updates',
      buttonDisabled: false,
      statusText: ''
    });
  });
});
