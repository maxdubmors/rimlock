// A secret value as TypeScript holds it (docs/spec/core-api.md § 2, security.md § Leaks): it
// prints and serialises as `[Secret]`, so a log or a stray `JSON.stringify` never carries it.

const placeholder = '[Secret]';

/**
 * The bytes live outside the object, so neither inspection nor a DevTools console shows them,
 * whatever it is told to ignore.
 */
const contents = new WeakMap<Secret, Uint8Array>();

export class Secret {
  /** Holds `bytes`, UTF-8 for a text secret, without copying them: `wipe()` zeroes them. */
  constructor(bytes: Uint8Array) {
    contents.set(this, bytes);
  }

  static fromText(text: string): Secret {
    return new Secret(new TextEncoder().encode(text));
  }

  /** The secret as text, for the one field being shown, filled or copied. */
  reveal(): string {
    return new TextDecoder().decode(bytesOf(this));
  }

  /** Best effort: zeroes the bytes; the Secret reveals nothing afterwards. */
  wipe(): void {
    bytesOf(this).fill(0);
    contents.set(this, new Uint8Array());
  }

  toString(): string {
    return placeholder;
  }

  toJSON(): string {
    return placeholder;
  }

  /** What Node's `util.inspect`, and so `console.log`, prints. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return placeholder;
  }
}

function bytesOf(secret: Secret): Uint8Array {
  return contents.get(secret) ?? new Uint8Array();
}

/**
 * A copy of the secret's bytes, which the caller wipes once used. Only the protocol codec, which
 * encodes a Secret, and `CoreClient`, which unwraps it at a Core call, read them (core-api.md
 * § 2, § 9).
 */
export function exposeSecret(secret: Secret): Uint8Array {
  return bytesOf(secret).slice();
}
