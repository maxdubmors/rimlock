# FSA permission lifecycle probe (throwaway)

Evidence for [Verify Chrome File System Access permission lifecycle in extension contexts](https://github.com/maxdubmors/rimlock/issues/16). Findings: [`docs/research/fsa-permission-lifecycle.md`](../../docs/research/fsa-permission-lifecycle.md). Not production code.

- `extension/`: MV3 extension with no build step. It has a popup and an extension tab (`page.html`), an offscreen document and a service worker. All of them run the same operations from `probe.js` (`adopt`, `query`, `request`, `read`, `write`, `hold`/`release`, `rewrite`, `rewriteOpen`/`closePending`, `snapshot`/`readSnapshot`) and log to `chrome.storage.local`. You can also click it by hand: load it unpacked, then use the drop zone or the "pick" button.
- `lib.js`: launches Chrome over CDP (puppeteer-core) on a persistent `profile/`, with `--load-extension`, so every launch is a real browser restart.
- `lifecycle.js`: experiments E0–E5 (popup, SW, offscreen, tab, restart). It deletes `profile/` first.
- `every-visit.js`: answers the tab's restore prompt with "Allow on every visit" (an `xdotool` click at the button's position in a default-size window under XWayland), then restarts.
- `interop.js`: writes a real `.kdbx` next to `keepassxc-cli` saves under `inotifywait`. `extras.js`: the symlink follow-up.
- `results/`: the output of one run of all four scripts, in order, on Chrome for Testing 155.0.8059.39 (Linux, niri + XWayland). `screenshots/`: the tab's restore prompt.

Run (needs `keepassxc-cli`, `inotifywait`, `xdotool`, `niri`):

```sh
pnpm install
npx @puppeteer/browsers install chrome@stable   # Chrome for Testing; branded Chrome ignores --load-extension
export CHROME=$PWD/chrome/linux-*/chrome-linux64/chrome
node lifecycle.js && node every-visit.js && node interop.js && node extras.js
```

Why drag-and-drop instead of the picker: CDP intercepts `showOpenFilePicker()` (`Page.fileChooserOpened` arrives without a `backendNodeId`) but cannot answer it. `Input.dispatchDragEvent` with `files` delivers an OS drop, and `DataTransferItem.getAsFileSystemHandle()` turns it into the same `FileSystemFileHandle`. Grants are keyed by origin and path, not by how the handle was obtained.
