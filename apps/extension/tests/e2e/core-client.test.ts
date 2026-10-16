import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, inject } from 'vitest';

import { CoreClient } from '../../src/background/core-client';
import type { FormatVersion, KdfParameters } from '../../src/core-bindings/rimlock_core_wasm.js';
import { describeCoreClientContract, type Role, type TestDatabase } from '../contract/core-client';

type Bindings = typeof import('../../src/core-bindings/rimlock_core_wasm.js');

/** One entry of the generator's `databases.json` (engineering.md § Corpora and data). */
type Generated = {
  file: string;
  formatVersion: FormatVersion;
  kdf: KdfParameters['kind'];
  masterPassword: string | null;
  keyFile: string | null;
};

const files: Record<Role, string> = {
  password: 'scenario.kdbx',
  keyFile: 'scenario-key-file.kdbx',
  passwordAndKeyFile: 'scenario-password-key-file.kdbx',
  kdbx31: 'scenario-3.1.kdbx',
};

/**
 * The Core instantiated in Node from the `dev-wasm` build: the same `.wasm` and glue a background
 * loads, minus the browser.
 */
async function loadCore(bindingsDir: string): Promise<Bindings> {
  const glue = (await import(
    pathToFileURL(join(bindingsDir, 'rimlock_core_wasm.js')).href
  )) as Bindings;
  glue.initSync({ module: await readFile(join(bindingsDir, 'rimlock_core_wasm_bg.wasm')) });
  return glue;
}

async function testDatabases(fixturesDir: string): Promise<Record<Role, TestDatabase>> {
  const generated = JSON.parse(
    await readFile(join(fixturesDir, 'databases.json'), 'utf8'),
  ) as Generated[];
  const databases = {} as Record<Role, TestDatabase>;
  for (const [role, file] of Object.entries(files) as [Role, string][]) {
    const entry = generated.find((database) => database.file === file);
    if (entry === undefined) throw new Error(`databases.json lists no ${file}`);
    databases[role] = {
      bytes: new Uint8Array(await readFile(join(fixturesDir, file))),
      name: 'rimlock scenario',
      formatVersion: entry.formatVersion,
      kdf: entry.kdf,
      ...(entry.masterPassword !== null && { masterPassword: entry.masterPassword }),
      ...(entry.keyFile !== null && {
        keyFile: new Uint8Array(await readFile(join(fixturesDir, entry.keyFile))),
      }),
    };
  }
  return databases;
}

/**
 * The file with its Argon2 iterations raised by one: what the Local copy holds after another
 * client saved it with other KDF parameters. The KDF parameters are a variant map in the outer
 * header; the iterations are its UInt64 item `I`.
 */
function withOtherKdfParameters(bytes: Uint8Array): Uint8Array {
  const item = [0x05, 1, 0, 0, 0, 'I'.charCodeAt(0), 8, 0, 0, 0];
  const at = bytes.findIndex((_, index) =>
    item.every((byte, offset) => bytes[index + offset] === byte),
  );
  if (at < 0) throw new Error('no Argon2 iterations in the header');
  const changed = bytes.slice();
  changed[at + item.length] = (changed[at + item.length] ?? 0) + 1;
  return changed;
}

describe('CoreClient over the real Core (dev-wasm)', () => {
  describeCoreClientContract(async () => {
    const { bindingsDir, fixturesDir } = inject('core');
    const databases = await testDatabases(fixturesDir);
    return {
      client: new CoreClient(() => loadCore(bindingsDir)),
      databases,
      staleLocalCopy: withOtherKdfParameters(databases.password.bytes),
    };
  });
});
