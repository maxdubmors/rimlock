import { describe } from 'vitest';

import { CoreClient } from '../../src/background/core-client';
import { fakeDatabase, FakeCore } from '../../src/background/fake-core';
import { describeCoreClientContract, type TestDatabase } from './core-client';

function database(options: Omit<TestDatabase, 'bytes'> & { seed?: string }): TestDatabase {
  return { ...options, bytes: fakeDatabase(options) };
}

const keyFile = new TextEncoder().encode('<KeyFile>fake</KeyFile>');
const scenario = { name: 'rimlock scenario', formatVersion: '4.1', kdf: 'Argon2d' } as const;
const password = { ...scenario, masterPassword: 'rmlk-master-fake' };

describe('CoreClient over FakeCore', () => {
  describeCoreClientContract(() =>
    Promise.resolve({
      client: new CoreClient(() => Promise.resolve(new FakeCore())),
      databases: {
        password: database(password),
        keyFile: database({ ...scenario, keyFile, seed: 'key-file' }),
        passwordAndKeyFile: database({ ...password, keyFile, seed: 'both' }),
        kdbx31: database({ ...password, formatVersion: '3.1', kdf: 'AesKdf', seed: '3.1' }),
      },
      staleLocalCopy: database({ ...password, seed: 'saved again' }).bytes,
    }),
  );
});
