# Runtime verification list

Facts the spec relies on that nobody has verified in a real browser yet. Each one is checked in **M0** ([`plan.md`](plan.md)), on the stable channel of each browser, on the platforms listed. M0 is not done until every **Result** cell is filled.

How to record a result: write what was observed, the browser and OS versions, and the date, and link the probe (a branch or a test). If the expected outcome holds, nothing else changes. If it does not:

- when a **Plan B** is written below, apply it and update the spec file named in **Decides** in the same pull request;
- when there is no Plan B, or the Plan B is marked "needs a decision", open an issue labelled `needs-triage` and link it here. Work that depends on the row waits for it.

## Core and runtime

| ID | Check | Expected | Decides | Plan B | Result |
|---|---|---|---|---|---|
| V1 | Wake-up rebuild (WASM instantiate + IndexedDB read + decrypt + XML parse) of the reference Database, Chrome service worker and Firefox event page, on the owner's mid-range laptop | ≤ 200 ms in both | [ADR-0005](../adr/0005-unlocked-state-rebuilt-on-every-wake-up.md), [`databases-and-unlock.md`](databases-and-unlock.md) | Keep an `EntrySummary` index in `storage.session` and decrypt lazily. Not designed: **needs a decision**. | |
| V2 | The `.wasm` loads and runs in the Chrome service worker, the Firefox event page and extension pages (popup, tab, offscreen) from the release bundle, under the manifest CSP | Loads everywhere with only `'wasm-unsafe-eval'` | [ADR-0003](../adr/0003-core-over-keepass-rs-fork.md), [ADR-0004](../adr/0004-mv3-on-every-browser.md) | **Needs a decision.** | |
| V3 | AMO accepts an unlisted `0.0.N` built by `build-release.sh`, and its reviewer build from the source package following `BUILDING.md` reproduces the `SHA256SUMS` | Accepted, identical hashes | [ADR-0018](../adr/0018-releases-built-by-ci-uploaded-by-hand.md), [`engineering.md`](engineering.md) | Fix the container and `BUILDING.md`; never a reason to change the Core (ADR-0003). | |
| V4 | Toolchain: WXT builds with `typescript` aliased to TS 6; `svelte-check` and typescript-eslint run on it; `no-misused-promises` flags `onclick={asyncFn}` in `.svelte`; the resolved-path boundary plugin catches a re-export | All work | [`engineering.md`](engineering.md) | Boundary rules fall back to `no-restricted-imports`; a Svelte rule gap is recorded in `apps/extension/AGENTS.md`. | |
| V5 | Test harness mechanisms: stop the Chrome service worker over CDP; force the Firefox event page idle (`extensions.background.idle.timeout`); serve fixtures and the WebDAV test servers under several host names (`--host-resolver-rules` in Chrome, the Firefox equivalent; in the Node suite, a custom `lookup` on the global undici dispatcher); install fake clocks in page contexts before load | All work in both browsers and in Node | [ADR-0017](../adr/0017-browser-tests-drive-the-store-bundle-through-puppeteer.md) | Browsers: the scenario that cannot be expressed moves to the manual checklist. Node: run `test:webdav` in a container on the Docker network, where the names resolve natively. | |

## Local file (Chrome) and file dialogs

| ID | Check | Expected | Decides | Plan B | Result |
|---|---|---|---|---|---|
| V6 | Dropped: adding a Database and **Locate file…** always run in a tab, so the picker never runs in the popup. | — | — | — | not needed |
| V7 | A file dialog (`<input type=file>`) opened from the Chrome popup closes it, on Linux and macOS (Firefox: known yes) | Recorded per OS | Whether a Key file can ever be picked in the Chrome popup ([`databases-and-unlock.md`](databases-and-unlock.md)) | Keep **Unlock in a tab…** for every Database that needs a Key file and has none remembered (already the default). | |
| V8 | The offscreen document holds a `FileSystemFileHandle` passed from the popup; after the popup closes and the service worker idles out, the background can still write the file through it until the browser closes | Grant alive; write succeeds | [ADR-0007](../adr/0007-local-file-source-per-browser.md) | Write only while an extension page is open (ADR-0007's fallback). | |
| V9 | `FileSystemObserver` in the offscreen document reports a save by KeePassXC (atomic rename) | A change event | [`sources.md`](sources.md) | Detect only on popup open and before every write (already done too). | |

## Storage, permissions and injection

| ID | Check | Expected | Decides | Plan B | Result |
|---|---|---|---|---|---|
| V10 | `storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})` on the Chrome floor version: a content script then gets an error; whether it must be re-applied after a browser restart | Error in content scripts; re-applied on every start anyway | [`settings.md`](settings.md) | Rely on the lint rules alone, as in Firefox. | |
| V11 | Chrome per-site "block all extensions" vs `permissions.contains` for that origin | `contains` may stay true; the content-script ping fails | [`manifest-and-permissions.md`](manifest-and-permissions.md) | The ping alone decides (already part of the check). | |
| V12 | A specific origin granted through `permissions.request` (WebDAV Connect) survives narrowing and then broadening site access, in both browsers | Survives | [`sources.md`](sources.md) | Every Sync already checks `contains` and offers **Grant**; document the extra prompt. | |
| V13 | Firefox runs declared content scripts in open tabs after a later host grant | Recorded | [`manifest-and-permissions.md`](manifest-and-permissions.md) | Inject on `permissions.onAdded` (already planned in both browsers); drop it in Firefox if redundant. | |
| V14 | `tabs.query` returns the tab `url` under `activeTab` with site access withheld and no `tabs` permission, in both browsers | Returns it | The popup's Matches without site access ([`autofill.md`](autofill.md)) | Get the URL from a one-off `scripting` injection result. | |
| V15 | `<a download>` of a Blob from a Firefox extension page (Remove → **Download a copy**) without the `downloads` permission | Saves the file | [`databases-and-unlock.md`](databases-and-unlock.md) | Request `downloads` there too, as for Export…. | |

## Locking

| ID | Check | Expected | Decides | Plan B | Result |
|---|---|---|---|---|---|
| V16 | Chrome delivers `windows.onRemoved` for the last normal window before the profile is torn down (Linux, macOS, Windows) | Delivered, lock runs | [`databases-and-unlock.md`](databases-and-unlock.md) | Rely on `storage.session` dying with the profile; record that the lock reason is then `session-lost`. | |
| V17 | Firefox on macOS: `storage.session` after the last window closes while the app keeps running | Recorded | [`databases-and-unlock.md`](databases-and-unlock.md) | The `windows.onRemoved` lock already covers it. | |
| V18 | Idle time across system suspend: does `idle` report `"idle"`/`"locked"` after resume, and does the T1 deadline check lock on the first message after resume, in both browsers | Locks on the first message after resume | [`databases-and-unlock.md`](databases-and-unlock.md) | The deadline check on every message is authoritative; record any gap in T3. | |

## Clipboard and shortcuts

| ID | Check | Expected | Decides | Plan B | Result |
|---|---|---|---|---|---|
| V19 | The Chrome offscreen document reads and writes the clipboard through `execCommand` with no focus, and its `setTimeout` clears after the service worker has gone idle | Clears | [`generator-and-copy.md`](generator-and-copy.md) | Clear through `alarms` + the offscreen document woken by the background. | |
| V20 | Firefox: at the first Copy, the clipboard write lands before the `permissions.request` prompt closes the popup | Value on the clipboard | [`generator-and-copy.md`](generator-and-copy.md) | Request the clipboard permissions on the first-run screen instead of at the first Copy. | |
| V21 | Firefox `accesskey` (Alt+Shift+letter on Windows/Linux) vs extension commands Alt+Shift+K and Alt+Shift+U | The command wins on ordinary pages | [`generator-and-copy.md`](generator-and-copy.md) | Pick other defaults. **Needs a decision.** | |
| V22 | Which Chrome milestone shipped the Ctrl+Shift+L accelerator | Recorded (informational, for the shortcuts help page) | nothing | — | |
| V23 | `action.openPopup()` from the Inline-menu iframe's click handler in current Firefox, and the case where the promise resolves with no popup (the popup reports "ready", else the tab fallback) | Popup opens; the fallback works | [`autofill.md`](autofill.md) | The tab fallback for every in-page unlock in Firefox. | |

## Test infrastructure

| ID | Check | Expected | Decides | Plan B | Result |
|---|---|---|---|---|---|
| V24 | Puppeteer `acceptInsecureCerts: true` lets the Extension's background `fetch` reach a WebDAV server whose certificate comes from the throwaway test CA, in Chrome (CDP) and Firefox (BiDi) | Reaches it in both | [`engineering.md`](engineering.md) § Tests | Import the test CA into the test browser profile: Firefox's profile certificate DB; Chrome `--ignore-certificate-errors-spki-list` with the server certificate's SPKI hash. | |

## Out of the MVP

Inheriting `[workspace.lints]` across Cargo workspaces through a path dependency matters only when a Companion workspace exists; it is checked then.
