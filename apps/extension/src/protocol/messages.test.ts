import { describe, expect, it } from 'vitest';

import { Secret } from '../shared/secret';
import { encodeRequest, parseRequest } from './messages';

/** What the background receives: Chrome's runtime messaging serialises messages as JSON. */
function sent(request: Parameters<typeof encodeRequest>[0]): unknown {
  return JSON.parse(JSON.stringify(encodeRequest(request)));
}

describe('a message sent to the background', () => {
  it('is a status request when it asks for the status', () => {
    expect(parseRequest(sent({ kind: 'status' }))).toEqual({ kind: 'status' });
  });

  it('carries only the fields its kind defines', () => {
    expect(parseRequest({ kind: 'status', tabId: 7 })).toEqual({ kind: 'status' });
  });

  it('is an unlock request with the file and the Master password it was sent with', () => {
    const file = Uint8Array.from({ length: 300_000 }, (_, index) => index % 251);
    const request = parseRequest(
      sent({ kind: 'unlock', file, masterPassword: Secret.fromText('päss 🔑') }),
    );
    if (request?.kind !== 'unlock') throw new Error('not an unlock request');
    expect(request.file).toEqual(file);
    expect(request.masterPassword.reveal()).toBe('päss 🔑');
  });

  it('never carries the Master password as text', () => {
    const message = JSON.stringify(
      encodeRequest({
        kind: 'unlock',
        file: new Uint8Array(),
        masterPassword: Secret.fromText('hunter2'),
      }),
    );
    expect(message).not.toContain('hunter2');
  });

  it.each([
    undefined,
    null,
    'status',
    42,
    [],
    {},
    { kind: 'unlock' },
    { kind: 'unlock', file: 'AAAA', masterPassword: 'hunter2' },
    { kind: 'unlock', file: 'not base64!', masterPassword: { $secret: 'aHVudGVyMg==' } },
    { kind: 1 },
  ])('is no request when it is %j', (message) => {
    expect(parseRequest(message)).toBeUndefined();
  });
});
