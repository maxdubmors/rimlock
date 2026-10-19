// Violation: a deep import of a Proton module, type-only.
import type { randomForestModelProvider } from '@protontech/autofill/models/random_forest';

export type Provider = typeof randomForestModelProvider;
