// Violation: a type-only import still ties content-side code to background/.
import type { CoreClient } from '../background/core-client';

export type Leaked = CoreClient;
