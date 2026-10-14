// Usage: node smoke.mjs <wasm-bindgen out dir>
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2]);
const core = await import(pathToFileURL(join(dir, "rimlock_core_wasm.js")).href);
core.initSync({ module: readFileSync(join(dir, "rimlock_core_wasm_bg.wasm")) });

const file = core.createSample("pw");
console.log("version:", core.readVersion(file));
const summary = core.summarize(file, "pw");
console.log("summary:", JSON.stringify(summary));
console.log("merged bytes:", core.merge(file, file, "pw").length);
// keepass-rs panics (merge.rs "cannot re-add root") when the root Group UUIDs differ.
try { core.merge(file, core.createSample("pw"), "pw"); } catch (e) { console.log("unrelated merge:", e.constructor.name, e.message); }
try { core.summarize(file, "wrong"); } catch (e) { console.log("error:", JSON.stringify(e)); }
try { core.entryTitleAt(summary, 5); } catch (e) { console.log("panic:", e.constructor.name, e.message); }
