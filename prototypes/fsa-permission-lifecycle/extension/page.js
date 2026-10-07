import { run, log, readLog } from "./probe.js";

const ctx = new URLSearchParams(location.search).get("ctx") ?? "tab";
document.getElementById("ctx").textContent = `context: ${ctx}`;

async function render() {
  const entries = await readLog();
  document.getElementById("log").textContent = entries.map((e) => JSON.stringify(e)).join("\n");
}

for (const button of document.querySelectorAll("button[data-op]")) {
  button.addEventListener("click", async () => {
    const { target, op } = button.dataset;
    if (target) await chrome.runtime.sendMessage({ target, op });
    else await log(await run(ctx, op));
    await render();
  });
}

// Drag-and-drop yields the same FileSystemFileHandle as the picker; the CDP driver uses it
// because CDP can intercept but not answer a showOpenFilePicker() dialog.
const drop = document.getElementById("drop");
drop.addEventListener("dragover", (e) => e.preventDefault());
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  const pending = [...e.dataTransfer.items].filter((i) => i.kind === "file").map((i) => i.getAsFileSystemHandle());
  const entry = await run(ctx, "adopt", await pending[0]);
  await log(entry);
  await render();
});

document.getElementById("tab").addEventListener("click", () => chrome.tabs.create({ url: "page.html?ctx=tab" }));
document.getElementById("refresh").addEventListener("click", render);
document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.clear();
  await render();
});

// Exposed for the CDP driver.
globalThis.probe = { run: async (op, arg) => log(await run(ctx, op, arg)), readLog };

await log({ t: new Date().toISOString(), ctx, op: "load" });
await log(await run(ctx, "query"));
await render();
