// V2 probe (throwaway): instantiate the Core in an extension page and report the outcome.
import initCore, { coreInfo } from '../core-bindings/rimlock_core_wasm.js';

type ProbeResult = { where: string; version?: string; error?: string };
const api = (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome;

export async function loadCoreIn(where: string): Promise<ProbeResult> {
  let result: ProbeResult;
  try {
    await initCore();
    result = { where, version: coreInfo().version };
  } catch (error) {
    result = { where, error: String(error) };
  }
  (globalThis as unknown as { probeResult: ProbeResult }).probeResult = result;
  await api.runtime.sendMessage({ probe: result }).catch(() => undefined);
  return result;
}
