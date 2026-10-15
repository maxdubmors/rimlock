import { describe, expect, it } from 'vitest';

import { answer } from './router';

describe('the status request', () => {
  it('reports the version of the running Core', async () => {
    const running = () => Promise.resolve({ version: '1.2.3' });
    expect(await answer({ kind: 'status' }, running)).toEqual({
      core: 'running',
      version: '1.2.3',
    });
  });

  it('reports the Core unavailable when it cannot be instantiated, instead of never answering', async () => {
    const broken = () => Promise.reject(new WebAssembly.CompileError('blocked by the CSP'));
    expect(await answer({ kind: 'status' }, broken)).toEqual({ core: 'unavailable' });
  });
});
