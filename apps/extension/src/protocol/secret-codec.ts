// The one place a Secret is encoded (docs/spec/core-api.md § 2, security.md § Leaks): as
// `{ $secret: base64 }`, for a message to carry and its parser to decode back.

import { exposeSecret, Secret } from '../shared/secret';

export type EncodedSecret = { $secret: string };

export function encodeSecret(secret: Secret): EncodedSecret {
  const bytes = exposeSecret(secret);
  // btoa, since Uint8Array.prototype.toBase64 is newer than the Chrome floor (Chrome 140).
  const encoded = btoa(String.fromCharCode(...bytes));
  bytes.fill(0);
  return { $secret: encoded };
}

/** A Secret from a message field, or `undefined` if the field is not an encoded one. */
export function decodeSecret(value: unknown): Secret | undefined {
  if (typeof value !== 'object' || value === null || !('$secret' in value)) return undefined;
  if (typeof value.$secret !== 'string') return undefined;
  let binary: string;
  try {
    binary = atob(value.$secret);
  } catch {
    return undefined;
  }
  return new Secret(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}
