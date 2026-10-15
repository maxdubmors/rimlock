import { describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';

// Extension code imports `browser` from wxt/browser; under WxtVitest that is fakeBrowser.
describe('the test harness', () => {
  it('gives extension code an in-memory browser', async () => {
    await browser.storage.session.set({ marker: 'first test' });
    expect(await browser.storage.session.get('marker')).toEqual({ marker: 'first test' });
  });

  it('starts every test from an empty browser', async () => {
    expect(await browser.storage.session.get('marker')).toEqual({});
  });
});
