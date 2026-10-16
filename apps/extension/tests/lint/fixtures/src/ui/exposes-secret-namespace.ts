// Broken: the same, through a namespace import.
import * as secrets from '../../../../../src/shared/secret';

export const bytesOf = (secret: secrets.Secret): Uint8Array => secrets.exposeSecret(secret);
