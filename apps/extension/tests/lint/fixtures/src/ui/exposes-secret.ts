// Broken: only the protocol codec and CoreClient read a Secret's bytes.
import { exposeSecret, type Secret } from '../../../../../src/shared/secret';

export const bytesOf = (secret: Secret): Uint8Array => exposeSecret(secret);
