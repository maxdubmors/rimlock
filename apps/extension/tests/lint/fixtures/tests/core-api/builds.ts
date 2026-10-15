// Breaks the rule: a WXT build outside tests/manifest/ runs in parallel with the others.
import { buildBundle } from '../build-bundle';

export const built = buildBundle('chrome');
