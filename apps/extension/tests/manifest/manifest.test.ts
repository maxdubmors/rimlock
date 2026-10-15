import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build, type Logger } from 'wxt';

// The expected values are the table in docs/spec/manifest-and-permissions.md, written out by hand.

type Manifest = Record<string, unknown>;
type Browser = 'chrome' | 'firefox';

const root = resolve(import.meta.dirname, '../..');
let outDir: string;
const built: Record<Browser | 'chromeDev', Manifest> = {
  chrome: {},
  firefox: {},
  chromeDev: {},
};
const messages: Record<Browser, Record<string, unknown>> = { chrome: {}, firefox: {} };

function sorted(list: unknown): unknown {
  return Array.isArray(list) ? list.toSorted() : list;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

// Chrome's rule: the first 16 bytes of SHA-256 over the public key, each hex digit 0–f as a–p.
function extensionId(key: unknown): string {
  if (typeof key !== 'string') return '';
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex');
  return digest
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode('a'.charCodeAt(0) + parseInt(digit, 16)));
}

// Only errors reach the test output; WXT's progress and expected warnings would bury the results.
const ignore = (): void => undefined;
const quietLogger: Logger = {
  debug: ignore,
  log: ignore,
  info: ignore,
  success: ignore,
  warn: ignore,
  error: console.error,
  fatal: console.error,
  level: 1,
};

async function buildExtension(
  browser: Browser,
  mode: 'production' | 'development',
): Promise<{ manifest: Manifest; messages: Record<string, unknown> }> {
  const dir = join(outDir, `${browser}-${mode}`);
  await build({ root, browser, mode, outDir: dir, outDirTemplate: '.', logger: quietLogger });
  return {
    manifest: await readJson(join(dir, 'manifest.json')),
    messages: await readJson(join(dir, '_locales/en/messages.json')),
  };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'rimlock-manifest-'));
  // WXT's build spinner writes to stdout directly, past the logger.
  const spinner = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    // One at a time: every WXT build regenerates the same `.wxt/` folder.
    const chrome = await buildExtension('chrome', 'production');
    const firefox = await buildExtension('firefox', 'production');
    built.chrome = chrome.manifest;
    built.firefox = firefox.manifest;
    built.chromeDev = (await buildExtension('chrome', 'development')).manifest;
    messages.chrome = chrome.messages;
    messages.firefox = firefox.messages;
  } finally {
    spinner.mockRestore();
  }
}, 120_000);

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

// ADR-0013: the frozen required set. An update that adds to it disables the Extension in Chrome.
const frozenRequiredPermissions = [
  'storage',
  'unlimitedStorage',
  'idle',
  'alarms',
  'scripting',
  'activeTab',
];
const hostPattern = ['http://*/*', 'https://*/*'];

describe('the permissions', () => {
  it('in Chrome are the frozen set plus offscreen, with clipboard and privacy optional', () => {
    expect(built.chrome['host_permissions']).toEqual(hostPattern);
    expect(sorted(built.chrome['permissions'])).toEqual(
      sorted([...frozenRequiredPermissions, 'offscreen']),
    );
    expect(sorted(built.chrome['optional_permissions'])).toEqual(
      sorted(['clipboardRead', 'clipboardWrite', 'privacy']),
    );
  });

  it('in Firefox are the frozen set, with clipboard, privacy and downloads optional', () => {
    expect(built.firefox['host_permissions']).toEqual(hostPattern);
    expect(sorted(built.firefox['permissions'])).toEqual(sorted(frozenRequiredPermissions));
    expect(sorted(built.firefox['optional_permissions'])).toEqual(
      sorted(['clipboardRead', 'clipboardWrite', 'privacy', 'downloads']),
    );
  });

  it('never include optional host permissions', () => {
    expect(built.chrome).not.toHaveProperty('optional_host_permissions');
    expect(built.firefox).not.toHaveProperty('optional_host_permissions');
  });

  // manifest-and-permissions.md § Never declared; nativeMessaging arrives later as optional.
  const neverDeclared = [
    'tabs',
    'webRequest',
    'webNavigation',
    'background',
    'notifications',
    'contextMenus',
    'nativeMessaging',
  ];

  it.each(['chrome', 'firefox', 'chromeDev'] as const)(
    'never declare a forbidden permission or <all_urls> (%s)',
    (name) => {
      const manifest = built[name];
      const declared = [
        ...asList(manifest['permissions']),
        ...asList(manifest['optional_permissions']),
      ];
      expect(declared.filter((permission) => neverDeclared.includes(permission))).toEqual([]);
      expect(manifest).not.toHaveProperty('externally_connectable');
      expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    },
  );
});

describe.each(['chrome', 'firefox'] as const)('the %s manifest', (name) => {
  it('suggests the shortcuts of generator-and-copy.md and leaves Lock unbound', () => {
    const commands = built[name]['commands'];
    expect(commands).toEqual({
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+K', mac: 'MacCtrl+Shift+K' },
      },
      fill: {
        suggested_key: { default: 'Alt+Shift+U', mac: 'MacCtrl+Shift+U' },
        description: '__MSG_commandFill__',
      },
      lock: { description: '__MSG_commandLock__' },
    });
  });

  it('finds every __MSG_…__ it names in the English messages', () => {
    const names = [...JSON.stringify(built[name]).matchAll(/__MSG_(\w+)__/g)].map(
      (match) => match[1] ?? '',
    );
    expect(names).not.toEqual([]);
    expect(names.filter((message) => !(message in messages[name]))).toEqual([]);
  });

  it('runs the content script in every frame of http(s) pages, and nowhere else', () => {
    const scripts = asObjects(built[name]['content_scripts']);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ matches: hostPattern, all_frames: true });
    expect(scripts[0]).not.toHaveProperty('match_about_blank');
    expect(scripts[0]).not.toHaveProperty('match_origin_as_fallback');
  });

  it('exposes only the iframe pages to http(s) pages', () => {
    expect(built[name]['web_accessible_resources']).toEqual([
      {
        resources: ['inline-menu.html'],
        matches: hostPattern,
        // Chrome only: Firefox already gives every install its own random origin.
        ...(name === 'chrome' && { use_dynamic_url: true }),
      },
    ]);
  });

  it('allows WebAssembly in extension pages and never eval', () => {
    expect(built[name]['content_security_policy']).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    });
    expect(JSON.stringify(built[name])).not.toContain("'unsafe-eval'");
  });

  it('opens Settings in a tab', () => {
    expect(built[name]['options_ui']).toEqual({ page: 'options.html', open_in_tab: true });
  });
});

describe('the background', () => {
  it('is a service worker in Chrome', () => {
    expect(built.chrome['background']).toEqual({ service_worker: 'background.js' });
  });

  it('is a non-persistent event page in Firefox', () => {
    expect(built.firefox['background']).toEqual({ scripts: ['background.js'] });
  });
});

describe('the Chrome manifest', () => {
  it('requires the highest Chrome floor among the APIs rimlock uses (FileSystemObserver)', () => {
    expect(built.chrome['minimum_chrome_version']).toBe('133');
  });

  it('fixes the unpacked Extension ID in development builds', () => {
    expect(extensionId(built.chromeDev['key'])).toBe('ffppbikcbglhghalfcnhhblchapiblgc');
  });

  it('carries no key in release builds, and Firefox never does', () => {
    expect(built.chrome).not.toHaveProperty('key');
    expect(built.firefox).not.toHaveProperty('key');
    expect(built.firefox).not.toHaveProperty('minimum_chrome_version');
  });
});

describe('the Firefox manifest', () => {
  it('has a fixed ID, the current ESR as its floor and declares no data collection', () => {
    expect(built.firefox['browser_specific_settings']).toEqual({
      gecko: {
        id: 'rimlock@maxdubmors.github.io',
        strict_min_version: '153.0',
        data_collection_permissions: { required: ['none'] },
      },
    });
  });
});
