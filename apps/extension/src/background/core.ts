import initCore, * as bindings from '../core-bindings/rimlock_core_wasm.js';
import { CoreClient } from './core-client';

/**
 * The background's Core, instantiated on the first call. The wasm-bindgen glue finds the `.wasm`
 * through `new URL(…, import.meta.url)`, which Vite bundles as an asset with no plugin
 * (engineering.md § WASM build).
 */
export const core = new CoreClient(async () => {
  await initCore();
  return bindings;
});
