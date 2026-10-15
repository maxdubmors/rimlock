import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte', '@wxt-dev/i18n/module'],
  // Every import is explicit (engineering.md § TypeScript modules).
  imports: false,
  i18n: { localesDir: resolve(import.meta.dirname, 'locales') },
  // MV3 in both browsers; WXT defaults Firefox to MV2 (ADR-0004).
  manifestVersion: 3,
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
  },
});
