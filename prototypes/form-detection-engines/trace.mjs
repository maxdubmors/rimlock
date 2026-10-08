// node trace.mjs <fixture-name>: per-root trace of the walk variant (Chrome).
import puppeteer from "puppeteer-core";
import { readdirSync } from "node:fs";
import path from "node:path";
import { serveFixtures } from "./serve.mjs";
const find = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? find(path.join(d, e.name)) : e.name === "chrome" ? [path.join(d, e.name)] : []));
const server = process.argv.slice(2).every((n) => n.startsWith("http")) ? null : serveFixtures();
const browser = await puppeteer.launch({ executablePath: find(".chrome")[0], headless: true, enableExtensions: true, pipe: true });
await browser.installExtension(path.resolve("ext"));
for (const name of process.argv.slice(2)) {
  const page = await browser.newPage();
  await page.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
  await page.goto(name.startsWith("http") ? name : `http://localhost:8123/${name}.html`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));
  await new Promise((r) => setTimeout(r, 1500));
  const res = await page.evaluate((req) => new Promise((resolve) => {
    document.addEventListener("rl-result", (e) => resolve(e.detail), { once: true });
    document.dispatchEvent(new CustomEvent("rl-run", { detail: req }));
  }), JSON.stringify({ variant: "trace", frameKey: "f0" }));
  const t = JSON.parse(res).trace; console.log(`== ${name}\n${Array.isArray(t) ? t.join("\n") : JSON.stringify(t)}`);
  await page.close();
}
await browser.close();
server?.close();
