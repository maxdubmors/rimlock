// Keeps the rule: tests/manifest/ runs its files one at a time.
import { buildBundle } from '../build-bundle';

export const built = buildBundle('firefox');
