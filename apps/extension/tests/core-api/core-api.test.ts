import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// docs/spec/engineering.md § Rust crates: the committed .d.ts must match core-api.md. This test
// checks that every export is declared there; the reviewer checks signatures and failure
// behaviour (CODING_STANDARDS.md).

const bindings = resolve(import.meta.dirname, '../../src/core-bindings/rimlock_core_wasm.d.ts');
const coreApi = resolve(import.meta.dirname, '../../../../docs/spec/core-api.md');

// wasm-bindgen's own loader API, not the Core's.
const loaderExports = new Set(['InitInput', 'InitOutput', 'SyncInitInput', 'initSync']);

type Export = { kind: 'function' | 'type'; name: string };

function exportsOf(declarations: string): Export[] {
  const pattern = /^export (?:declare )?(function|interface|type|class|enum|const) (\w+)/gm;
  return [...declarations.matchAll(pattern)]
    .map(
      ([, keyword, name = '']) =>
        ({ kind: keyword === 'function' ? 'function' : 'type', name }) as const,
    )
    .filter(({ name }) => !loaderExports.has(name));
}

/** The ```ts blocks of the spec: prose and other files' mentions do not count as declarations. */
function tsBlocks(markdown: string): string {
  return [...markdown.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map((match) => match[1]).join('\n');
}

function declares(spec: string, { kind, name }: Export): boolean {
  const declaration =
    kind === 'function'
      ? new RegExp(`^\\s*${name}\\(`, 'm')
      : new RegExp(`\\b(?:type|interface|class) ${name}\\b`);
  return declaration.test(spec);
}

describe('the Core bindings', () => {
  it('export only what core-api.md declares', async () => {
    const exported = exportsOf(await readFile(bindings, 'utf8'));
    const spec = tsBlocks(await readFile(coreApi, 'utf8'));
    expect(exported).not.toEqual([]);
    expect(exported.filter((item) => !declares(spec, item))).toEqual([]);
  });
});
