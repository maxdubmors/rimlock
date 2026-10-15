import { describe, expect, it } from 'vitest';

import { parseRequest } from './messages';

describe('a message sent to the background', () => {
  it('is a status request when it asks for the status', () => {
    expect(parseRequest({ kind: 'status' })).toEqual({ kind: 'status' });
  });

  it('carries only the fields its kind defines', () => {
    expect(parseRequest({ kind: 'status', tabId: 7 })).toEqual({ kind: 'status' });
  });

  it.each([undefined, null, 'status', 42, [], {}, { kind: 'unlock' }, { kind: 1 }])(
    'is no request when it is %j',
    (message) => {
      expect(parseRequest(message)).toBeUndefined();
    },
  );
});
