import initCore, { coreInfo, type CoreInfo } from '../core-bindings/rimlock_core_wasm.js';

/** `docs/spec/core-api.md` § 8; only `CoreUnavailable` so far, `CoreClient` brings the rest. */
export type CoreResult<T> =
  { ok: true; value: T } | { ok: false; error: { kind: 'CoreUnavailable' } };

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

/**
 * What the Core says about itself, instantiating it first if this background has not yet.
 * Catches here, like `CoreClient` will, so callers switch on the result instead of catching.
 */
export async function describeCore(): Promise<CoreResult<CoreInfo>> {
  try {
    await instantiate();
    return { ok: true, value: coreInfo() };
  } catch {
    return { ok: false, error: { kind: 'CoreUnavailable' } };
  }
}
