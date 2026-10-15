// Violation: ui/ imports background/ directly instead of going through protocol/.
import { coreClient } from '../background/core-client';

export const shown = coreClient.name;
