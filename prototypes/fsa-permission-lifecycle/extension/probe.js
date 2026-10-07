// Shared probe operations. Runs in the popup, an extension tab, the offscreen
// document and the service worker; every result is a plain JSON log entry.

const DB = "probe";
const STORE = "handles";

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(handle) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, "file");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadHandle() {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get("file");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function handle() {
  const h = await loadHandle();
  if (!h) throw new Error("no handle stored");
  return h;
}

async function permissions(h) {
  return {
    read: await h.queryPermission({ mode: "read" }),
    readwrite: await h.queryPermission({ mode: "readwrite" }),
  };
}

export const ops = {
  async pick() {
    const [h] = await showOpenFilePicker();
    await saveHandle(h);
    return { name: h.name, ...(await permissions(h)) };
  },
  async pickAndRequest() {
    const [h] = await showOpenFilePicker();
    await saveHandle(h);
    const requested = await h.requestPermission({ mode: "readwrite" });
    return { name: h.name, requested, ...(await permissions(h)) };
  },
  async adopt(h) {
    await saveHandle(h);
    return { name: h.name, ...(await permissions(h)) };
  },
  // Keeps a live handle in this context's globals (the grant holder under test).
  async hold() {
    globalThis.heldHandle = await handle();
    return permissions(globalThis.heldHandle);
  },
  async release() {
    delete globalThis.heldHandle;
    return "released";
  },
  async query() {
    return permissions(await handle());
  },
  async request() {
    const h = await handle();
    return { requested: await h.requestPermission({ mode: "readwrite" }), ...(await permissions(h)) };
  },
  async read() {
    const f = await (await handle()).getFile();
    const text = await f.text();
    return { size: f.size, lastModified: f.lastModified, head: text.slice(0, 80) };
  },
  async write(payload) {
    const w = await (await handle()).createWritable();
    await w.write(payload ?? `written by probe at ${new Date().toISOString()}\n`);
    await w.close();
    return "closed";
  },
  // Writes the file's own bytes back, so a .kdbx stays valid.
  async rewrite() {
    const h = await handle();
    const bytes = await (await h.getFile()).arrayBuffer();
    const t0 = performance.now();
    const w = await h.createWritable();
    await w.write(bytes);
    await w.close();
    return { bytes: bytes.byteLength, writeMs: Math.round(performance.now() - t0) };
  },
  async rewriteOpen() {
    const h = await handle();
    const bytes = await (await h.getFile()).arrayBuffer();
    globalThis.pendingWritable = await h.createWritable();
    await globalThis.pendingWritable.write(bytes);
    return "open";
  },
  // Leaves a writable open so a test can observe the .crswap file, then kill
  // the context or call closePending/abortPending.
  async writeOpen(payload) {
    globalThis.pendingWritable = await (await handle()).createWritable();
    await globalThis.pendingWritable.write(payload ?? "pending write\n");
    return "open";
  },
  async closePending() {
    await globalThis.pendingWritable.close();
    return "closed";
  },
  async abortPending() {
    await globalThis.pendingWritable.abort();
    return "aborted";
  },
  // Keeps a File snapshot to check what happens when the file is replaced underneath.
  async snapshot() {
    globalThis.snapshotFile = await (await handle()).getFile();
    return { size: globalThis.snapshotFile.size, lastModified: globalThis.snapshotFile.lastModified };
  },
  async readSnapshot() {
    const text = await globalThis.snapshotFile.text();
    return { head: text.slice(0, 80) };
  },
};

const PENDING = Symbol("pending");

export async function run(ctx, op, arg, timeoutMs = 8000) {
  const activation = globalThis.navigator?.userActivation?.isActive ?? null;
  const t0 = performance.now();
  let result;
  let error;
  try {
    result = await Promise.race([
      ops[op](arg),
      new Promise((resolve) => setTimeout(() => resolve(PENDING), timeoutMs)),
    ]);
    if (result === PENDING) result = `still pending after ${timeoutMs} ms`;
  } catch (e) {
    error = `${e.name}: ${e.message}`;
  }
  return { t: new Date().toISOString(), ctx, op, activation, ms: Math.round(performance.now() - t0), result, error };
}

// chrome.storage is unavailable in offscreen documents; their entries are logged by the service worker.
export async function log(entry) {
  console.log("[probe]", JSON.stringify(entry));
  const key = `log:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await chrome.storage.local.set({ [key]: entry });
  return entry;
}

export async function readLog() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith("log:"))
    .sort()
    .map((k) => all[k]);
}
