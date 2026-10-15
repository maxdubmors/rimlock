# V2 probe (throwaway)

Evidence for `docs/spec/verification.md` V2 ([#43](https://github.com/maxdubmors/rimlock/issues/43)): does the Core's `.wasm` load under the manifest CSP in extension pages, not only in the background? Never merged.

- `src/probe/load-core.ts`: instantiates the Core in a page and reports `{ where, version | error }` over `runtime.sendMessage`.
- `popup.html` probes as `popup`, or as `tab` when opened with `?tab`; `offscreen.html` probes as `offscreen`; `welcome.html` collects the reports.
- `probe-v2.ts <chrome|firefox> <bundle>`: opens `welcome.html` and `popup.html?tab`, sends the `status` request to the background, calls `action.openPopup()` (Firefox: with `extensions.openPopupWithoutUserGesture.enabled`) and, in Chrome, `offscreen.createDocument()`.
- `PROBE_NO_WASM_CSP=1 wxt build` drops `'wasm-unsafe-eval'` from the CSP: the negative control.

```sh
scripts/build-core.sh && cd apps/extension
wxt build -b chrome   # or -b firefox; PROBE_NO_WASM_CSP=1 for the control
node probe-v2.ts chrome .output/chrome-mv3
```

## Results (Linux, headless, Chrome for Testing 155.0.8059.39, Firefox 157.0.1, puppeteer-core 25.13.0, 2026-10-15)

| Context | Chrome, shipped CSP | Firefox, shipped CSP | Without `'wasm-unsafe-eval'` |
|---|---|---|---|
| Background (service worker / event page) | loads | loads | blocked (no answer from the old router) |
| Tab (`popup.html?tab`) | loads | loads | `CompileError … violates the following Content Security policy` / `blocked by CSP` |
| Popup (`action.openPopup()`) | loads | loads | blocked |
| Offscreen document | loads | — | blocked |
