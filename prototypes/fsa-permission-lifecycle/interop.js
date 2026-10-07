// What a write through createWritable() looks like on disk next to KeePassXC
// (keepassxc-cli shares Database::save with the GUI). Run after every-visit.js:
// the profile's "Allow on every visit" grant lets the service worker write.
// Usage: CHROME=/path/to/chrome node interop.js
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { launch, openPopup, dropFile, lastEntry, click, sleep } from "./lib.js";

const dir = path.resolve("fixtures/interop");
const db = path.join(dir, "interop.kdbx");
const linkDir = path.join(dir, "synced");
const link = path.join(linkDir, "link.kdbx");
const PASSWORD = "probe-password";

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(linkDir, { recursive: true });
const cli = (...args) =>
  execFileSync("keepassxc-cli", args, { input: `${PASSWORD}\n${PASSWORD}\n`, stdio: ["pipe", "pipe", "pipe"] }).toString();
cli("db-create", "--set-password", db);
cli("add", db, "seed-entry");
// 0640, not 0600: shows whether a write keeps the mode or applies its own default.
fs.chmodSync(db, 0o640);
fs.symlinkSync(db, link);

const stat = (p) => {
  const s = fs.lstatSync(p);
  return `inode=${s.ino} mode=${(s.mode & 0o777).toString(8)} size=${s.size} symlink=${s.isSymbolicLink()}`;
};
const entries = () => cli("ls", db).trim().split("\n").join(",");
const listDir = (d) => fs.readdirSync(d).join(", ");

const events = [];
const watcher = spawn("inotifywait", [
  "-m", "-q", "--format", "%e %f",
  "-e", "create", "-e", "modify", "-e", "close_write", "-e", "moved_from", "-e", "moved_to", "-e", "delete", "-e", "attrib",
  dir,
]);
watcher.stdout.on("data", (d) => events.push(...d.toString().trim().split("\n")));
await sleep(500);
const drainEvents = (label) => {
  console.log(`   inotify (${label}): ${events.splice(0).join(" | ") || "none"}`);
};

const { browser, sw } = await launch();
const report = (step, e) => console.log(`${step.padEnd(56)} ${JSON.stringify(e.error ?? e.result)}  (${e.ms} ms)`);
const inSw = async (step, op) => report(step, await sw.evaluate((op) => globalThis.probe.run(op), op));
const inOffscreen = async (step, op) => report(step, await sw.evaluate((op) => globalThis.probe.offscreen(op), op));

// Adopted in the popup, where requestPermission() is auto-granted; the service
// worker then holds the handle so the grant outlives the popup.
async function adopt(file) {
  const popup = await openPopup(browser, sw);
  let since = new Date().toISOString();
  await dropFile(popup, file);
  report(`popup: adopt ${path.basename(file)}`, await lastEntry(sw, "popup", "adopt", since));
  since = new Date().toISOString();
  await click(popup, "request");
  report("popup: request with gesture", await lastEntry(sw, "popup", "request", since));
  await sw.evaluate(() => globalThis.probe.run("hold"));
  await popup.close();
}

console.log("## I1 service worker rewrites the .kdbx with its own bytes");
await adopt(db);
drainEvents("setup");
console.log(`   before: ${stat(db)}`);
await inSw("I1.1 sw: rewrite", "rewrite");
await sleep(300);
console.log(`   after:  ${stat(db)}; dir: ${listDir(dir)}; keepassxc-cli ls: ${entries()}`);
drainEvents("I1");

console.log("## I2 KeePassXC saves (temp + rename) while the extension holds the handle");
await inSw("I2.1 sw: snapshot File", "snapshot");
cli("add", db, "external-1");
await sleep(300);
drainEvents("keepassxc-cli add");
await inSw("I2.2 sw: read stale snapshot", "readSnapshot");
await inSw("I2.3 sw: read through the handle", "read");
console.log(`   after:  ${stat(db)}`);

console.log("## I3 KeePassXC saves while the extension's writable is open");
await inSw("I3.1 sw: open writable, write current bytes", "rewriteOpen");
console.log(`   dir while open: ${listDir(dir)}`);
cli("add", db, "external-2");
console.log(`   keepassxc-cli ls after its save: ${entries()}`);
await inSw("I3.2 sw: close writable", "closePending");
await sleep(300);
console.log(`   keepassxc-cli ls after close(): ${entries()}`);
drainEvents("I3");

console.log("## I4 context dies with a writable open");
await inOffscreen("I4.1 offscreen: open writable", "rewriteOpen");
console.log(`   dir while open: ${listDir(dir)}`);
await sw.evaluate(() => globalThis.probe.closeOffscreen());
await sleep(1500);
console.log(`   dir after offscreen closed: ${listDir(dir)}`);
drainEvents("I4");

console.log("## I5 the adopted path is a symlink");
await adopt(link);
console.log(`   before: link ${stat(link)} -> ${fs.readlinkSync(link)}`);
await inSw("I5.1 sw: rewrite through the symlink handle", "rewrite");
await sleep(300);
console.log(`   after:  link ${stat(link)}; target ${stat(db)}; synced/: ${listDir(linkDir)}`);

watcher.kill();
await browser.close();
