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
  it('reject a content-side import of background/ through a re-export', async () => {
    expect(await rulesBrokenIn('src/protocol/reexport-background.ts')).toContain(
      'import-x/no-restricted-paths',
    );
  });

  it('reject ui/ importing background/ directly', async () => {
    expect(await rulesBrokenIn('src/ui/imports-background.ts')).toContain(
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

  it('rejects both WXT storage modules', async () => {
    const broken = await rulesBrokenIn('src/autofill/wxt-storage.ts');
    expect(broken.filter((rule) => rule === 'no-restricted-imports')).toHaveLength(2);
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
