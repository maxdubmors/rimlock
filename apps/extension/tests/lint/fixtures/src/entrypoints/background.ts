// Allowed: the background entrypoint is the one way into background/.
import { coreClient } from '../background/core-client';

export const name = coreClient.name;
