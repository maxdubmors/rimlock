// Permission lifecycle experiments across popup, extension tab, offscreen
// document and service worker. Every experiment runs in a fresh browser
// session on the same profile, so each one also starts "after a restart".
// Usage: CHROME=/path/to/chrome node lifecycle.js
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, openTab, openPopup, click, dropFile, lastEntry, profilePath, sleep } from "./lib.js";

const fixture = path.resolve("fixtures/lifecycle.txt");
fs.mkdirSync("fixtures", { recursive: true });
fs.writeFileSync(fixture, "lifecycle fixture\n");
fs.rmSync(profilePath, { recursive: true, force: true });

let browser, sw, extensionId;

function report(step, entry) {
  const { result, error, activation, ms } = entry;
  console.log(`${step.padEnd(64)} ${JSON.stringify(error ?? result)}  (activation=${activation}, ${ms} ms)`);
}

const inSw = async (step, op) => report(step, await sw.evaluate((op) => globalThis.probe.run(op), op));
const inOffscreen = async (step, op) => report(step, await sw.evaluate((op) => globalThis.probe.offscreen(op), op));

// puppeteer's page.evaluate() and waitForFunction() pass userGesture: true, so
// go through raw CDP and first let any transient activation (5 s) expire.
async function inPageNoGesture(page, step, op) {
  await sleep(5500);
  const cdp = await page.createCDPSession();
  const { result } = await cdp.send("Runtime.evaluate", {
    expression: `globalThis.probe.run(${JSON.stringify(op)})`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  await cdp.detach();
  report(step, result.value);
}

async function inPageClick(page, ctx, step, op) {
  const since = new Date().toISOString();
  await click(page, op);
  report(step, await lastEntry(sw, ctx, op, since, 12000));
}

// Drops every unreferenced handle in the service worker (stands in for the
// worker being torn down, which destroys its whole heap).
async function gcServiceWorker() {
  await sw.evaluate(() => globalThis.probe.run("release"));
  await sw.client.send("HeapProfiler.collectGarbage");
  await sleep(300);
}

function screenshot(name) {
  const file = path.resolve(`fixtures/${name}.png`);
  try {
    // niri (Wayland) screenshot of the focused window; also copies it to the clipboard.
    execFileSync("niri", ["msg", "action", "screenshot-window", "--path", file]);
    console.log(`   screenshot: ${file}`);
  } catch (e) {
    console.log(`   screenshot failed: ${e.message}`);
  }
}

async function session(title, body) {
  const started = new Date().toISOString();
  ({ browser, sw, extensionId } = await launch());
  console.log(`\n## ${title}`);
  await body(started);
  await browser.close();
}

// ---------------------------------------------------------------------------
await session("E0 setup: adopt a handle in the popup (fresh profile)", async () => {
  console.log(`   ${await browser.version()}, extension ${extensionId}`);
  const popup = await openPopup(browser, sw);
  const since = new Date().toISOString();
  await dropFile(popup, fixture);
  report("E0.1 popup: adopt handle by drop", await lastEntry(sw, "popup", "adopt", since));
});

await session("E1 after restart; popup grant with no other holder", async () => {
  await inSw("E1.1 sw right after startup: query", "query");
  await inSw("E1.2 sw: read", "read");
  const opened = new Date().toISOString();
  const popup = await openPopup(browser, sw);
  report("E1.3 popup on load: query", await lastEntry(sw, "popup", "query", opened));
  await inPageNoGesture(popup, "E1.4 popup: request without gesture", "request");
  await inPageClick(popup, "popup", "E1.5 popup: request with gesture (click)", "request");
  await inSw("E1.6 sw (popup open): query", "query");
  await gcServiceWorker();
  await popup.close();
  await sleep(1000);
  await inSw("E1.7 sw (popup closed, nothing else held a handle): query", "query");
  await inSw("E1.8 sw: read", "read");
  await inSw("E1.9 sw: request (no frame, no gesture)", "request");
});

await session("E2 service worker holds a handle", async () => {
  const popup = await openPopup(browser, sw);
  await inPageClick(popup, "popup", "E2.1 popup: request with gesture", "request");
  await inSw("E2.2 sw: hold handle", "hold");
  await popup.close();
  await sleep(1000);
  await inSw("E2.3 sw (popup closed): query", "query");
  await inSw("E2.4 sw: write", "write");
  await gcServiceWorker();
  await inSw("E2.5 sw (handle released + GC): query", "query");
});

await session("E3 offscreen document holds a handle", async () => {
  await inOffscreen("E3.1 offscreen: hold handle (before any grant)", "hold");
  const popup = await openPopup(browser, sw);
  await inPageClick(popup, "popup", "E3.2 popup: request with gesture", "request");
  await popup.close();
  await sleep(1000);
  await gcServiceWorker();
  await inSw("E3.3 sw (popup closed, sw GC'd, offscreen holds): query", "query");
  await inSw("E3.4 sw: write", "write");
  await gcServiceWorker();
  await sw.evaluate(() => globalThis.probe.closeOffscreen());
  await sleep(1000);
  await inSw("E3.5 sw (offscreen closed): query", "query");
  await inOffscreen("E3.6 offscreen (new): request", "request");
  await sw.evaluate(() => globalThis.probe.closeOffscreen());
});

await session("E4 extension tab", async () => {
  const tab = await openTab(browser, extensionId);
  await inPageNoGesture(tab, "E4.1 tab: request without gesture", "request");
  const since = new Date().toISOString();
  await click(tab, "request");
  await sleep(2500);
  screenshot("e4-tab-prompt");
  report("E4.2 tab: request with gesture (click)", await lastEntry(sw, "tab", "request", since, 12000));
  await tab.close();
});

await session("E5 tab holds a handle; grant made in the popup", async () => {
  const tab = await openTab(browser, extensionId);
  await inPageNoGesture(tab, "E5.1 tab: hold handle", "hold");
  const popup = await openPopup(browser, sw);
  await inPageClick(popup, "popup", "E5.2 popup: request with gesture", "request");
  await popup.close();
  await sleep(1000);
  await inPageNoGesture(tab, "E5.3 tab (popup closed): query", "query");
  await gcServiceWorker();
  await tab.close();
  await sleep(1000);
  await inSw("E5.4 sw (tab closed): query", "query");
});

console.log("\n# done");
