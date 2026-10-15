import { browser } from 'wxt/browser';

// Violation: a module content code imports reads storage.
export const settings = browser.storage.local.get('settings');
