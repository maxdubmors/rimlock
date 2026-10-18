import { describe } from 'vitest';

import { FakeSource } from '../../src/sources/fake-source';
import { describeSourceAdapterContract } from './source-adapter';

describe('FakeSource', () => {
  describeSourceAdapterContract({
    subjectFor: (bytes) => {
      const source = new FakeSource(bytes);
      return Promise.resolve({
        adapter: source,
        saveElsewhere: (bytes) => {
          source.saveElsewhere(bytes);
          return Promise.resolve();
        },
        saveElsewhereDuringNextWrite: (bytes) => {
          source.saveElsewhereDuringNextWrite(bytes);
          return Promise.resolve();
        },
        failWith: (fault) => {
          source.failWith(fault);
          return Promise.resolve();
        },
      });
    },
    faults: ['offline', 'not-found', 'auth', 'permission-needed'],
  });
});
