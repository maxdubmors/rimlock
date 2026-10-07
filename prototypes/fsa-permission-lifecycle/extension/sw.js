import { run, log, readLog } from "./probe.js";

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "File System Access probe",
  });
}

async function viaOffscreen(op, arg) {
  await ensureOffscreen();
  return log(await chrome.runtime.sendMessage({ target: "offscreen", op, arg }));
}

chrome.runtime.onStartup.addListener(async () => {
  await log({ t: new Date().toISOString(), ctx: "sw", op: "onStartup" });
  await log(await run("sw", "query"));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target === "sw") {
    run("sw", msg.op, msg.arg).then(log).then(sendResponse);
    return true;
  }
  if (msg.target === "offscreen-via-sw") {
    viaOffscreen(msg.op, msg.arg).then(sendResponse);
    return true;
  }
  if (msg.target === "sw-control" && msg.op === "closeOffscreen") {
    chrome.offscreen.closeDocument().then(() => sendResponse("closed"), (e) => sendResponse(String(e)));
    return true;
  }
});

// Entry points for the CDP driver (evaluated in the service worker target).
globalThis.probe = {
  run: async (op, arg) => log(await run("sw", op, arg)),
  offscreen: viaOffscreen,
  closeOffscreen: () => chrome.offscreen.closeDocument(),
  openPopup: () => chrome.action.openPopup(),
  readLog,
  clearLog: () => chrome.storage.local.clear(),
};
