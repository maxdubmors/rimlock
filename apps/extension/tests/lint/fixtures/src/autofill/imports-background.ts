// Violation: content-side code imports background/ directly.
import { coreClient } from '../background/core-client';

export const leaked = coreClient.name;
