// Loads each corpus page in Chrome for Testing, stamps every frame, runs Bitwarden
// then Proton in the page's main world, and writes results/raw/<name>.json plus a
// screenshot. Usage: node run.mjs [name-filter]
// Bitwarden runs first because it only sets JS properties (opid); Proton writes
// data-protonpass-* attributes that Bitwarden would otherwise read.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { serveFixtures } from "./serve.mjs";

const CHROME = process.env.CHROME;
if (!CHROME) throw new Error("set CHROME to the Chrome for Testing binary");
const filter = process.argv[2];
const stamp = readFileSync("stamp.js", "utf8").trim().replace(/;$/, "");
const bundles = {
  bitwarden: readFileSync("dist/bitwarden.js", "utf8"),
  proton: readFileSync("dist/proton.js", "utf8"),
};
for (const d of ["results/raw", "results/screens", "snapshots"]) mkdirSync(d, { recursive: true });

const server = serveFixtures();

const sites = JSON.parse(readFileSync("corpus/sites.json", "utf8"));
const fixtures = readFileSync("corpus/fixtures.txt", "utf8").split("\n").filter(Boolean)
  .map((f) => ({ name: `fixture-${f.replace(".html", "")}`, url: `http://localhost:8123/${f}` }));
const corpus = [...fixtures, ...sites].filter((e) => !filter || e.name.includes(filter));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--lang=en-US", "--window-size=1280,900"],
});
const ua = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runFrame(frame, key) {
  const out = { url: frame.url() };
  try {
    Object.assign(out, await frame.evaluate(`(${stamp})(${JSON.stringify(key)})`));
  } catch (e) {
    return { ...out, error: `stamp: ${e.message.split("\n")[0]}` };
  }
  if (!out.fields.length) return out;
  for (const [engine, code] of Object.entries(bundles)) {
    try {
      out[engine] = await frame.evaluate(`${code}; __rl_${engine}.detect()`);
    } catch (e) {
      out[engine] = { error: e.message.split("\n")[0] };
    }
  }
  return out;
}

for (const entry of corpus) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setBypassCSP(true);
  await page.setUserAgent(ua);
  await page.setViewport({ width: 1280, height: 900 });
  const result = { name: entry.name, url: entry.url, kind: entry.kind ?? "fixture", note: entry.note, capturedAt: new Date().toISOString() };
  try {
    await page.goto(entry.url, { waitUntil: "networkidle2", timeout: 30000 }).catch((e) => (result.gotoWarning = e.message));
    await sleep(entry.wait ?? 2500);
    for (const step of entry.steps ?? []) {
      if (step.type) await page.locator(step.type).fill(step.text);
      if (step.press) await page.keyboard.press(step.press);
      if (step.click) await page.locator(step.click).click();
      await sleep(step.wait ?? 3000);
    }
    result.finalUrl = page.url();
    result.frames = [];
    let i = 0;
    for (const frame of page.frames()) {
      if (frame.detached || !/^https?:/.test(frame.url())) continue;
      result.frames.push(await runFrame(frame, `f${i++}`));
    }
    await page.screenshot({ path: `results/screens/${entry.name}.jpg`, type: "jpeg", quality: 45 });
    if (entry.kind) {
      const cdp = await page.createCDPSession();
      const { data } = await cdp.send("Page.captureSnapshot", { format: "mhtml" });
      writeFileSync(`snapshots/${entry.name}.mhtml`, data);
    }
  } catch (e) {
    result.error = e.message.split("\n")[0];
  }
  writeFileSync(`results/raw/${entry.name}.json`, JSON.stringify(result, null, 1));
  const n = (result.frames ?? []).reduce((s, f) => s + (f.fields?.length ?? 0), 0);
  console.log(`${entry.name}: ${result.error ?? `${result.frames?.length} frames, ${n} inputs`} ${result.gotoWarning ? "(goto timeout)" : ""}`);
  await ctx.close();
}
await browser.close();
server.close();
