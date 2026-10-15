import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

const hostPattern = ['http://*/*', 'https://*/*'];

// Public half only; the private key was never kept. Gives development builds the unpacked ID
// ffppbikcbglhghalfcnhhblchapiblgc (manifest-and-permissions.md § Extension IDs).
const chromeDevelopmentKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAys0IOLAQ8jB5V44ibriS3HNiHLDto9H/qGBxJvy38x+1KqAhaHzricPiKjpT+DVZzZfysSXxFa81imHW78Wp8QpscFJIAXZgm/lQt+XySNi/7qexrhjjWK+E60jdp/g9p+iADaNJUr6wMJoEoGK43zkifDKnJCZvUoqYxkRBEzbTYKLyA1T4DXaH4mui80aOyW5UEA+V+rxUGnTrbI1DMBX0uW1Qt2/GR9GpFpaWW4JucmaqkCbQm0mkCR7Z9J4el8/wsVHBZqZpBkofy0qV0r/gP9JqZjA9ntrlaenbx7LS0Z+fOEYwa5CIqLaBU9Dx8bFxoNokzGrIV7XcEW2ruwIDAQAB';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte', '@wxt-dev/i18n/module'],
  // Every import is explicit (engineering.md § TypeScript modules).
  imports: false,
  i18n: { localesDir: resolve(import.meta.dirname, 'locales') },
  // MV3 in both browsers; WXT defaults Firefox to MV2 (ADR-0004).
  manifestVersion: 3,
  // docs/spec/manifest-and-permissions.md § Manifest; tests/manifest/ checks the built result.
  manifest: ({ browser, mode }) => ({
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    // Not <all_urls>: the same warning, for schemes rimlock never fills (ADR-0013).
    host_permissions: [...hostPattern],
    // The frozen required set: never grows after the first release (ADR-0013).
    permissions: [
      'storage',
      'unlimitedStorage',
      'idle',
      'alarms',
      'scripting',
      'activeTab',
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    // Requested inside the click that needs them; a refusal disables only that feature.
    optional_permissions: [
      'clipboardRead',
      'clipboardWrite',
      'privacy',
      ...(browser === 'firefox' ? ['downloads'] : []),
    ],
    // Defaults from generator-and-copy.md § Keyboard shortcuts; Lock ships unbound.
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+K', mac: 'MacCtrl+Shift+K' },
      },
      fill: {
        suggested_key: { default: 'Alt+Shift+U', mac: 'MacCtrl+Shift+U' },
        description: '__MSG_commandFill__',
      },
      lock: { description: '__MSG_commandLock__' },
    },
    // Only the iframe pages, never scripts or WASM; pages reach them through runtime.getURL().
    web_accessible_resources: [
      {
        resources: ['inline-menu.html'],
        matches: [...hostPattern],
        ...(browser !== 'firefox' && { use_dynamic_url: true }),
      },
    ],
    // The MV3 default plus WebAssembly for the Core; never 'unsafe-eval'.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    ...(browser !== 'firefox' && {
      // The highest floor among the APIs used: FileSystemObserver (manifest-and-permissions.md).
      minimum_chrome_version: '133',
    }),
    ...(browser !== 'firefox' && mode === 'development' && { key: chromeDevelopmentKey }),
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // Fixed forever after the AMO dry run: Companion host manifests name it (ADR-0011).
          id: 'rimlock@maxdubmors.github.io',
          strict_min_version: '153.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
