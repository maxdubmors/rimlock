// Collects the probe reports of the popup and the offscreen document.
const results: unknown[] = [];
(globalThis as unknown as { probeResults: unknown[] }).probeResults = results;
(
  globalThis as unknown as {
    chrome: { runtime: { onMessage: { addListener(f: (m: { probe?: unknown }) => void): void } } };
  }
).chrome.runtime.onMessage.addListener((message) => {
  if (message.probe !== undefined) results.push(message.probe);
});
