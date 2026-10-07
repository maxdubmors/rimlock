// Shared helpers for the CDP drivers. Launches Chrome with the probe extension
// and a persistent profile so runs can span browser restarts.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const extensionPath = path.join(here, "extension");
export const profilePath = path.join(here, "profile");

export async function launch({ headless = false } = {}) {
  const executablePath = process.env.CHROME;
  if (!executablePath) throw new Error("set CHROME to the Chrome binary");
  const browser = await puppeteer.launch({
    executablePath,
    headless,
    userDataDir: profilePath,
    pipe: true,
    // --load-extension (still honoured by Chrome for Testing) keeps the extension
    // installed across restarts, so chrome.runtime.onStartup fires as for users.
    enableExtensions: true,
    defaultViewport: null,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--ozone-platform=x11",
      `--load-extension=${extensionPath}`,
      `--disable-extensions-except=${extensionPath}`,
    ],
  });
  const sw = await serviceWorker(browser);
  const extensionId = new URL(sw.url()).host;
  return { browser, sw, extensionId };
}

export async function serviceWorker(browser) {
  const target = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"),
    { timeout: 15000 },
  );
  const worker = await target.worker();
  for (let i = 0; i < 50 && !(await worker.evaluate(() => !!globalThis.probe)); i++) await sleep(100);
  return worker;
}

export async function openTab(browser, extensionId) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/page.html?ctx=tab`);
  await page.waitForFunction(() => globalThis.probe);
  return page;
}

export async function openPopup(browser, sw) {
  const waiting = browser.waitForTarget((t) => t.url().includes("page.html?ctx=popup"), { timeout: 10000 });
  await sw.evaluate(() => globalThis.probe.openPopup());
  const page = await (await waiting).asPage();
  await page.waitForFunction(() => globalThis.probe);
  return page;
}

// Clicks a probe button with a real CDP mouse event, so the page gets user activation.
export async function click(page, op, target) {
  const selector = target ? `button[data-target="${target}"][data-op="${op}"]` : `button:not([data-target])[data-op="${op}"]`;
  await page.click(selector);
}

export async function lastEntry(sw, ctx, op, sinceIso, timeoutMs = 20000) {
  for (let i = 0; i < timeoutMs / 200; i++) {
    const log = await sw.evaluate(() => globalThis.probe.readLog());
    const hit = log.filter((e) => e.ctx === ctx && e.op === op && (!sinceIso || e.t >= sinceIso)).at(-1);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no log entry for ${ctx}/${op}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Simulates dropping a file from the OS onto the probe's drop zone.
export async function dropFile(page, file) {
  const box = await (await page.$("#drop")).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const data = { items: [], files: [file], dragOperationsMask: 1 };
  const cdp = await page.createCDPSession();
  for (const type of ["dragEnter", "dragOver", "drop"]) {
    await cdp.send("Input.dispatchDragEvent", { type, x, y, data });
  }
  await cdp.detach();
}
