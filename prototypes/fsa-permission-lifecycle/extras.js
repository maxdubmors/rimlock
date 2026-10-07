// Follow-up after interop.js, whose last adopted handle is a symlink.
import { launch } from "./lib.js";
const { browser, sw } = await launch();
const run = async (step, op) => {
  const e = await sw.evaluate((op) => globalThis.probe.run(op), op);
  console.log(`${step.padEnd(48)} ${JSON.stringify(e.error ?? e.result).slice(0, 160)}`);
};
await run("X1 sw: query (stored handle = link.kdbx)", "query");
await run("X2 sw: read through symlink handle", "read");
await run("X3 sw: write through symlink handle", "write");
await browser.close();
