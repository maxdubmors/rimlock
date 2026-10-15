import { browser } from 'wxt/browser';

// Violation: content code reaches storage by destructuring.
const { storage } = browser;

export const settings = storage.local.get('settings');
