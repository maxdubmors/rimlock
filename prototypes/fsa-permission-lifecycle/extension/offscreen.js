import { run } from "./probe.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return;
  run("offscreen", msg.op, msg.arg).then(sendResponse);
  return true;
});
