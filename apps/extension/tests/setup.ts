import { beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

// Every test starts from an empty browser: no storage, no listeners.
beforeEach(() => {
  fakeBrowser.reset();
});
