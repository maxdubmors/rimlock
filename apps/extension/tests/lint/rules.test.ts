import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { createConfig } from '../../eslint.config';

// The fixture tree mirrors src/; each file holds one deliberate violation.
const fixtures = resolve(import.meta.dirname, 'fixtures');
const eslint = new ESLint({
  cwd: fixtures,
  overrideConfigFile: true,
  overrideConfig: createConfig(fixtures),
});

async function rulesBrokenIn(file: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintFiles([resolve(fixtures, file)]);
  const messages = result?.messages ?? [];
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${file} did not parse: ${fatal.message}`);
  return messages.map((message) => message.ruleId);
}

describe('module boundaries', () => {
  it.each([
    ['content-side code importing background/', 'src/autofill/imports-background.ts'],
    ['a type-only import of background/', 'src/autofill/type-import.ts'],
    ['content-side code importing ui/', 'src/autofill/imports-ui.ts'],
    [
      'content-side code re-exporting another entrypoint',
      'src/entrypoints/content/reexports-popup.ts',
    ],
    [
      'a module content code imports re-exporting background/',
      'src/protocol/reexport-background.ts',
    ],
    ['ui/ importing background/ directly', 'src/ui/imports-background.ts'],
    ['any other module re-exporting background/', 'src/sources/reexport-background.ts'],
  ])('reject %s', async (_, file) => {
    expect(await rulesBrokenIn(file)).toContain('import-x/no-restricted-paths');
  });

  it('let the background entrypoint import background/', async () => {
    expect(await rulesBrokenIn('src/entrypoints/background.ts')).not.toContain(
      'import-x/no-restricted-paths',
    );
  });
});

describe('content code and storage', () => {
  it('rejects browser.storage', async () => {
    expect(await rulesBrokenIn('src/autofill/browser-storage.ts')).toContain(
      'no-restricted-properties',
    );
  });

  it('rejects browser.storage reached by destructuring', async () => {
    expect(await rulesBrokenIn('src/entrypoints/content/destructured-storage.ts')).toContain(
      'no-restricted-properties',
    );
  });

  it('rejects browser.storage in a module content code imports', async () => {
    expect(await rulesBrokenIn('src/protocol/browser-storage.ts')).toContain(
      'no-restricted-properties',
    );
  });

  it('rejects the storage global', async () => {
    expect(await rulesBrokenIn('src/autofill/storage-global.ts')).toContain(
      'no-restricted-globals',
    );
  });

  it('rejects both WXT storage modules', async () => {
    const broken = await rulesBrokenIn('src/autofill/wxt-storage.ts');
    expect(broken.filter((rule) => rule === 'no-restricted-imports')).toHaveLength(2);
  });
});

describe('WXT builds in tests', () => {
  // Every build regenerates the same .wxt/ folder; only tests/manifest/ runs one file at a time.
  it('rejects buildBundle outside tests/manifest/', async () => {
    expect(await rulesBrokenIn('tests/core-api/builds.ts')).toContain('no-restricted-imports');
  });

  it('accepts buildBundle in tests/manifest/', async () => {
    expect(await rulesBrokenIn('tests/manifest/builds.ts')).not.toContain('no-restricted-imports');
  });

  it('accepts a type from build-bundle anywhere', async () => {
    expect(await rulesBrokenIn('tests/core-api/browser-type.ts')).not.toContain(
      'no-restricted-imports',
    );
  });
});

describe('Svelte', () => {
  // typescript-eslint's no-misused-promises checks JSX attributes only, so a local rule does it.
  it('rejects a promise-returning event handler', async () => {
    const broken = await rulesBrokenIn('src/ui/AsyncClick.svelte');
    expect(broken.filter((rule) => rule === 'rimlock/no-async-event-handler')).toHaveLength(3);
  });

  it('accepts event handlers that return nothing', async () => {
    expect(await rulesBrokenIn('src/ui/SyncClick.svelte')).toEqual([]);
  });
});
