import { describe, expect, it } from 'vitest';

import { Secret } from '../shared/secret';
import { decodeSecret, encodeSecret } from './secret-codec';

/** What another context receives: Chrome's runtime messaging serialises messages as JSON. */
function sent(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('a Secret in a message', () => {
  it('arrives as the same secret', () => {
    expect(decodeSecret(sent(encodeSecret(Secret.fromText('päss wörd 🔑'))))?.reveal()).toBe(
      'päss wörd 🔑',
    );
  });

  it('is base64 under $secret', () => {
    expect(encodeSecret(Secret.fromText('hunter2'))).toEqual({ $secret: 'aHVudGVyMg==' });
  });

  it('keeps bytes that are not text', () => {
    const bytes = new Uint8Array([0, 255, 128, 1, 0xc3]);
    const decoded = decodeSecret(sent(encodeSecret(new Secret(bytes.slice()))));
    const twice = decoded && encodeSecret(decoded);
    expect(twice).toEqual(encodeSecret(new Secret(bytes)));
  });

  it('leaves the encoded Secret usable', () => {
    const secret = Secret.fromText('hunter2');
    encodeSecret(secret);
    expect(secret.reveal()).toBe('hunter2');
  });

  it.each([
    undefined,
    null,
    'aHVudGVyMg==',
    {},
    { $secret: 42 },
    { $secret: 'not base64!' },
    '[Secret]',
  ])('is no Secret when it is %j', (value) => {
    expect(decodeSecret(value)).toBeUndefined();
  });
});
