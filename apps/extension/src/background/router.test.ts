import { describe, expect, it } from 'vitest';

import { answer } from './router';

describe('the status request', () => {
  it('reports the version of the running Core', async () => {
    const running = () => Promise.resolve({ ok: true as const, value: { version: '1.2.3' } });
    expect(await answer({ kind: 'status' }, running)).toEqual({
      core: 'running',
      version: '1.2.3',
    });
  });

  it('reports the Core unavailable when it cannot be instantiated, instead of never answering', async () => {
    const unavailable = () =>
      Promise.resolve({ ok: false as const, error: { kind: 'CoreUnavailable' as const } });
    expect(await answer({ kind: 'status' }, unavailable)).toEqual({ core: 'unavailable' });
  });
});
