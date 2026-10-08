// Shadow-root check: loads ext/ as an unpacked extension, so detection runs in a
// real content script's isolated world where closed roots can be opened.
// Every page is loaded once per variant (see ext/content.ts for why).
// Usage: node run-ext.mjs <chrome|firefox> <fixtures|live|shadow-live> [name-filter]
// Writes results/shadow/<browser>/<page>.json: { runs: { <variant>: frames[] } }.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { serveFixtures } from "./serve.mjs";

const [browserName = "chrome", scope = "fixtures", filter] = process.argv.slice(2);
const VARIANTS = ["proton", "protonWalk", "protonGroup"];
const binary = (dir, re) => {
  const find = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? find(path.join(d, e.name)) : re.test(e.name) ? [path.join(d, e.name)] : []));
  return find(dir)[0];
};
const outDir = `results/shadow/${browserName}`;
mkdirSync(outDir, { recursive: true });

const server = serveFixtures();
const fixtures = readFileSync("corpus/fixtures-shadow.txt", "utf8").split("\n").filter(Boolean)
  .map((f) => ({ name: `fixture-${f.replace(".html", "")}`, url: `http://localhost:8123/${f}` }));
const sites = JSON.parse(readFileSync("corpus/sites.json", "utf8"));
const SHADOW_LIVE = ["reddit-login", "reddit-register", "archive-org-login", "archive-org-home"];
const corpus = { fixtures, live: sites, "shadow-live": sites.filter((s) => SHADOW_LIVE.includes(s.name)) }[scope]
  .filter((e) => !filter || e.name.includes(filter));

const browser = await puppeteer.launch(browserName === "firefox"
  ? { browser: "firefox", executablePath: binary(".firefox", /^firefox$/), headless: true, enableExtensions: true }
  : { executablePath: binary(".chrome", /^chrome$/), headless: true, enableExtensions: true, pipe: true, args: ["--no-first-run", "--lang=en-US", "--window-size=1280,900"] });
await browser.installExtension(path.resolve("ext"));
const version = await browser.version();
const ua = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page's main world: hands the request to the content script and waits for its reply.
const ask = (req) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(JSON.stringify({ url: location.href, error: "no reply from content script" })), 15000);
  document.addEventListener("rl-result", (e) => { clearTimeout(t); resolve(e.detail); }, { once: true });
  document.dispatchEvent(new CustomEvent("rl-run", { detail: req }));
});

async function runPage(entry, variant) {
  const page = await browser.newPage();
  if (browserName === "chrome") await page.setUserAgent(ua);
  await page.setViewport({ width: 1280, height: 900 });
  const frames = [];
  let warning;
  try {
    await page.goto(entry.url, { waitUntil: "networkidle2", timeout: 30000 }).catch((e) => (warning = e.message));
    await sleep(entry.wait ?? 2500);
    for (const step of entry.steps ?? []) {
      if (step.type) await page.locator(step.type).fill(step.text);
      if (step.press) await page.keyboard.press(step.press);
      if (step.click) await page.locator(step.click).click();
      await sleep(step.wait ?? 3000);
    }
    let i = 0;
    for (const frame of page.frames()) {
      if (frame.detached || !/^https?:/.test(frame.url())) continue;
      const req = JSON.stringify({ variant, frameKey: `f${i++}` });
      try {
        frames.push(JSON.parse(await frame.evaluate(ask, req)));
      } catch (e) {
        frames.push({ url: frame.url(), error: e.message.split("\n")[0] });
      }
    }
  } finally {
    await page.close();
  }
  return { frames, warning };
}

for (const entry of corpus) {
  const result = { name: entry.name, url: entry.url, kind: entry.kind ?? "fixture", browser: version, capturedAt: new Date().toISOString(), runs: {} };
  for (const v of VARIANTS) {
    try {
      const { frames, warning } = await runPage(entry, v);
      result.runs[v] = frames;
      if (warning) result.gotoWarning = warning;
    } catch (e) {
      result.runs[v] = [{ error: e.message.split("\n")[0] }];
    }
  }
  writeFileSync(`${outDir}/${entry.name}.json`, JSON.stringify(result, null, 1));
  const summary = VARIANTS.map((v) => {
    const fr = result.runs[v];
    const err = fr.find((f) => f.error || f[v]?.error);
    const n = fr.reduce((s, f) => s + (f[v]?.fields?.length ?? 0), 0);
    return `${v}=${err ? `ERR ${err.error ?? err[v].error}` : n}`;
  }).join(" ");
  console.log(`${entry.name}: ${summary}`);
}
await browser.close();
server.close();
