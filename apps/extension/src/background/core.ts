import initCore, { coreInfo, type CoreInfo } from '../core-bindings/rimlock_core_wasm.js';

let instantiated: Promise<unknown> | undefined;

/**
 * Instantiates the Core once per background lifetime. The wasm-bindgen glue finds the `.wasm`
 * through `new URL(…, import.meta.url)`, which Vite bundles as an asset with no plugin
 * (engineering.md § WASM build). A failed attempt is forgotten, so the next call retries.
 */
async function instantiate(): Promise<void> {
  instantiated ??= initCore().catch((error: unknown) => {
    instantiated = undefined;
    throw error;
  });
  await instantiated;
}

/** What the Core says about itself, instantiating it first if this background has not yet. */
export async function describeCore(): Promise<CoreInfo> {
  await instantiate();
  return coreInfo();
}
