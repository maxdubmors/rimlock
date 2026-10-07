// node debug.mjs <url>: prints Bitwarden's qualification trace for one page.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { serveFixtures } from "./serve.mjs";
const server = serveFixtures();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true });
const page = await browser.newPage();
await page.goto(process.argv[2], { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
const stamp = readFileSync("stamp.js", "utf8").trim().replace(/;$/, "");
await page.evaluate(`(${stamp})("f0")`);
const engine = process.argv[3] ?? "bitwarden";
console.dir(await page.evaluate(`${readFileSync(`dist/${engine}.js`, "utf8")}; __rl_${engine}.debug()`), { depth: 5 });
await browser.close();
server.close();
