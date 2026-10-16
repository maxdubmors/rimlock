// Broken: the same, through a namespace import.
import * as secrets from '../../../../../src/shared/secret';

export const bytesOf = (secret: secrets.Secret): Uint8Array => secrets.exposeSecret(secret);

// Broken: the same, destructured or read by a computed name.
const { exposeSecret } = secrets;
export const destructured = exposeSecret;
export const computed = secrets['exposeSecret'];
