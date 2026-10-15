import { browser } from 'wxt/browser';

// Violation: content code reads storage.
export const settings = browser.storage.local.get('settings');
