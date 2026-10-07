// What "Allow on every visit" in an extension tab does to the service worker
// after a browser restart. Run after lifecycle.js (needs its stored handle).
// The prompt button is clicked with xdotool at its position in a default-size
// window under XWayland; check the screenshots if the layout differs.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, openTab, openPopup, click, lastEntry, sleep } from "./lib.js";

let browser, sw, extensionId;

function report(step, entry) {
  const { result, error, ms } = entry;
  console.log(`${step.padEnd(64)} ${JSON.stringify(error ?? result)}  (${ms} ms)`);
}
const inSw = async (step, op) => report(step, await sw.evaluate((op) => globalThis.probe.run(op), op));
const windowShot = (name) =>
  execFileSync("niri", ["msg", "action", "screenshot-window", "--path", path.resolve(`fixtures/${name}.png`)]);

({ browser, sw, extensionId } = await launch());
console.log("## 0: grant in the popup, then quit with no tab ever closed");
const popup0 = await openPopup(browser, sw);
const since0 = new Date().toISOString();
await click(popup0, "request");
report("0.1 popup: request with gesture", await lastEntry(sw, "popup", "request", since0));
await popup0.close();
await browser.close();

({ browser, sw, extensionId } = await launch());
console.log("## A: answer the tab's restore prompt with 'Allow on every visit'");
const tab = await openTab(browser, extensionId);
await sleep(5500);
const since = new Date().toISOString();
await click(tab, "request");
await sleep(2000);
windowShot("every-visit-before-click");
execFileSync("xdotool", ["mousemove", "285", "350", "click", "1"]);
await sleep(1000);
report("A.1 tab: request answered", await lastEntry(sw, "tab", "request", since, 12000));
await tab.close();
await sleep(1000);
await sw.evaluate(() => globalThis.probe.run("release"));
await sw.client.send("HeapProfiler.collectGarbage");
await inSw("A.2 sw (tab closed, no holder): query", "query");
await browser.close();

({ browser, sw, extensionId } = await launch());
console.log("## B: after restart, nothing opened");
await inSw("B.1 sw: query", "query");
await inSw("B.2 sw: read", "read");
await inSw("B.3 sw: write", "write");
await inSw("B.4 sw: request (no gesture)", "request");
await inSw("B.5 sw: query", "query");
const popup = await openPopup(browser, sw);
report("B.6 popup on load: query", await lastEntry(sw, "popup", "query", since));
await popup.close();
await browser.close();
