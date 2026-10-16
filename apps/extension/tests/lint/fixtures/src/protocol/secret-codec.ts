// Allowed: the protocol codec encodes a Secret.
import { exposeSecret, type Secret } from '../../../../../src/shared/secret';

export const bytesOf = (secret: Secret): Uint8Array => exposeSecret(secret);
