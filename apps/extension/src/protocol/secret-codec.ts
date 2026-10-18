// The one place a Secret is encoded (docs/spec/core-api.md § 2, security.md § Leaks): as
// `{ $secret: base64 }`, for a message to carry and its parser to decode back, or for the
// background to keep the CachedKey in storage.session, which also holds only JSON.

import { exposeSecret, Secret } from '../shared/secret';
import { decodeBase64, encodeBase64 } from './base64';

export type EncodedSecret = { $secret: string };

export function encodeSecret(secret: Secret): EncodedSecret {
  const bytes = exposeSecret(secret);
  const encoded = encodeBase64(bytes);
  bytes.fill(0);
  return { $secret: encoded };
}

/** A Secret from a message field, or `undefined` if the field is not an encoded one. */
export function decodeSecret(value: unknown): Secret | undefined {
  if (typeof value !== 'object' || value === null || !('$secret' in value)) return undefined;
  if (typeof value.$secret !== 'string') return undefined;
  const bytes = decodeBase64(value.$secret);
  return bytes && new Secret(bytes);
}
