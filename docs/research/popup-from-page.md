# Opening the popup from in-page UI in Chrome and Firefox

Research for issue #23. Researched 2026-10-07. It feeds #15 ("Unlock and save" and "click to unlock") and builds on the UI-shape decision in #10, which routes every unlock that starts in a page to the toolbar popup.

Source dates: the Chrome reference page carries a "Last updated" date and MDN pages a "last modified" date; both are given in brackets. Source code is cited at the commit that was `HEAD` of the default branch on 2026-10-07 (SHAs listed in [Sources](#sources)).

## Question

Can a click inside an extension-origin iframe injected into a web page (the Inline menu or the Save prompt card, each in a closed shadow DOM) open the toolbar popup?

1. Chrome: since when is `action.openPopup()` available to all extensions? What are its preconditions (user gesture, focused window, popup set, calling contexts)? Can the iframe call it directly, or must it message the background?
2. Firefox: does `action.openPopup()` accept a click in such an iframe as the user action, both directly and after `runtime.sendMessage` to the background? Version caveats.
3. Safari: what the docs say (not in the MVP).
4. Fallback when the popup cannot be opened (extension tab or `windows.create({type: 'popup'})`), prior art, and how a pending save resumes after unlock.

## Summary

**Yes, in both browsers, with one call made directly from the iframe's click handler.**

- **Chrome 127+:** `action.openPopup()` is available to every extension and needs **no user gesture**. Chromium checks only that the target window is active, that it has a visible toolbar, and that the extension has a popup on the active tab. It can be called from any privileged extension context, including an extension iframe inside a web page and the background service worker. Content scripts cannot call it. Verified empirically in Chrome for Testing 154 (see [Empirical check](#empirical-check-chrome)).
- **Firefox 149+ (released 2026-03-24):** the user-gesture requirement is gone on all channels. Only a focused, non-minimised window is required. Both the direct call and the call via the background work.
- **Firefox 109–148:** a user gesture is required on release builds. A call made synchronously in the iframe's click handler should qualify, because the iframe is a full extension page and Firefox reads the gesture flag from the calling document (source-reading only, not run). A call made after `runtime.sendMessage` to the background does **not** qualify (MDN, and a Bugzilla user report). ESR 140, the last ESR below 149, reaches end of life on 2026-10-13. After that every supported desktop Firefox is 149+ (ESR 153 included).
- **Firefox for Android:** `action.openPopup()` is not supported yet (bug 1817809).
- **Safari:** MDN compat data lists `action.openPopup()` from Safari 16. Apple's documentation says nothing about it. A 2022 cross-browser test by a Chrome DevRel engineer found no gesture requirement in Safari.

**Cases where `openPopup()` fails even in Chrome:** the current window has no toolbar (a site-opened `window.open` popup, such as an OAuth sign-in window, or a fullscreen window), another popup is already open, or the window is not active. The in-page UI therefore needs a fallback.

**Recommended pattern:**

1. Keep the pending save in `storage.session` from the moment the Save prompt is shown, not from the click.
2. In the iframe click handler, call `browser.action.openPopup()` **synchronously as the first statement** (no `await` before it, no detour through the background). This works on Chrome 127+ and Firefox 109+, and it does not depend on gesture propagation.
3. If it rejects, or the popup does not report itself as loaded within about 1 s, open the same UI **in a tab** with an `unlock` intent, next to the originating tab. #10 already requires that the full UI works in a tab, and a tab exists everywhere a popup window does not (Firefox for Android, Safari on iOS).
4. Whichever surface unlocks reads the pending save from `storage.session`, saves the Entry, clears the pending item, and (tab fallback only) closes itself and re-activates the originating tab.

### At a glance

| | Chrome | Firefox ≥ 149 | Firefox 109–148 | Safari |
|---|---|---|---|---|
| `action.openPopup()` available | 127+ (118–126 policy-installed only) | Yes | Yes | 16+ (MDN compat data) |
| User gesture required | No | No | Yes, on release builds (Nightly: no) | No (2022 test, not documented by Apple) |
| Direct call from extension iframe in a page | Works (verified) | Works (source) | Works if synchronous in the click handler (source, not run) | Undocumented |
| Call from background after `sendMessage` | Works (verified) | Works (source) | Rejected: "openPopup requires a user gesture" | Undocumented |
| Call from a content script | Not exposed | Not exposed | Not exposed | Not exposed |
| Window conditions | Active window with a visible toolbar | Focused, not minimised | Same | Undocumented |
| Rejects when another popup is open | Yes ("Could not find an active browser window.") | Yes | Inconsistent | Closes other extensions' popups (2022 test) |

## Findings

### 1. Chrome

**Availability.** "Beginning in Chrome 127, the `action.openPopup` API is available to all extensions. Previously, it was only available in Canary or to extensions installed by a policy" ([What's new, 2024-06-19](https://developer.chrome.com/docs/extensions/whats-new)). The API reference says "Chrome 127+" and "Between Chrome 118 and Chrome 126, this is only available to policy installed extensions" ([chrome.action, 2026-09-11](https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup)). MDN compat data agrees ([BCD `action.json`](https://github.com/mdn/browser-compat-data/blob/c56acf2f789157f7e47688e353fb66db0475ecf1/webextensions/api/action.json)).

**Preconditions.** The reference page lists only the `windowId` option ("Defaults to the currently-active window if unspecified"). The real rules are in [`ActionOpenPopupFunction::Run`](https://github.com/chromium/chromium/blob/76a9e5ddf3de5e65c610470a2e68aa23366659a8/chrome/browser/extensions/api/extension_action/extension_action_api.cc#L518-L580):

- **No user-gesture check** anywhere in the function.
- Without `windowId`, it takes the last active browser window of the profile and requires `IsActive()` ([`FindActiveBrowserWindow`](https://github.com/chromium/chromium/blob/76a9e5ddf3de5e65c610470a2e68aa23366659a8/chrome/browser/extensions/api/extension_action/extension_action_api.cc#L112-L118)). Otherwise it rejects with "Could not find an active browser window." With an explicit `windowId` for an inactive window it rejects with "Cannot show popup for an inactive window. To show the popup for this window, first call `chrome.windows.update` with `focused` set to true."
- The extension must have a visible popup on the active tab, or it rejects with "Extension does not have a popup on the active tab."
- [`OpenPopupInBrowser`](https://github.com/chromium/chromium/blob/76a9e5ddf3de5e65c610470a2e68aa23366659a8/chrome/browser/extensions/api/extension_action/extension_action_api.cc#L139-L170) requires the window to support and show a toolbar, or it rejects with "Browser window has no toolbar." Popup-type windows (what `window.open` with features creates) and fullscreen windows fail this check (verified below).
- If the toolbar refuses to show it (for example, a popup is already open), the call rejects with "Failed to open popup." Rob Wu's January 2026 comparison records that Chrome 143 rejects with the misleading "Could not find an active browser window." when a popup (its own or another extension's) is already showing ([w3c/webextensions#160](https://github.com/w3c/webextensions/issues/160#issuecomment-3774666519)).
- The promise resolves only after the popup document exists ([`OnShowPopupComplete`](https://github.com/chromium/chromium/blob/76a9e5ddf3de5e65c610470a2e68aa23366659a8/chrome/browser/extensions/api/extension_action/extension_action_api.cc#L582-L598)), so in Chrome a resolved promise means the popup opened.
- An action hidden in the Extensions menu is revealed and the popup opens (w3c/webextensions#160 table, "Behaviour when hidden in browser-specific UI").

**Calling contexts.** The whole `action` namespace has `"contexts": ["privileged_extension"]` ([`_api_features.json`](https://github.com/chromium/chromium/blob/76a9e5ddf3de5e65c610470a2e68aa23366659a8/chrome/common/extensions/api/_api_features.json#L27-L30)). Extension pages count as privileged extension contexts, and so do extension iframes embedded in a web page (`chrome.action.openPopup` was a function inside our injected iframe in the empirical check). It is not callable from content scripts (w3c/webextensions#160 table, "Callable from content script: No").

**Direct call vs. background.** Both work, because Chrome has no gesture to lose. A call from the background after a `runtime.sendMessage` round trip opened the popup in the empirical check, and so did a call 1.5 s after the click and a call 6 s after it (past Chrome's 5 s transient-activation window). The direct call is still preferable: it is one hop shorter, and the same code path then also works on Firefox 109–148.

#### Empirical check (Chrome)

Run on 2026-10-07 in headless Chrome for Testing 154.0.8037.92 via the `agent-browser` CLI. The throwaway MV3 probe extension had a `default_popup`, a content script that injects a `web_accessible_resources` iframe into a closed shadow root, and a service worker. Clicks were real CDP mouse events on the iframe. Results:

| Scenario | Result |
|---|---|
| `typeof chrome.action.openPopup` inside the iframe | `function` |
| Click in iframe → `chrome.action.openPopup()` directly | Resolved; popup document loaded; `runtime.getContexts({contextTypes: ['POPUP']})` = 1 |
| Click in iframe → `runtime.sendMessage` → background calls `openPopup()` | Resolved; popup loaded |
| Click, `await` 1.5 s, then `openPopup()` in iframe | Resolved; popup loaded |
| Click, `setTimeout` 6 s (activation expired), then `openPopup()` | Resolved; popup loaded |
| Call while the popup is already open | Rejected: "Could not find an active browser window." |
| Background: `windows.create({type: 'popup'})` with a page, focus it, `openPopup({windowId})` | Rejected: "Browser window has no toolbar." |
| Background: normal window set to `state: 'fullscreen'`, `openPopup({windowId})` | Rejected: "Browser window has no toolbar." |
| Iframe click → `tabs.create({url: extension page})` | Tab created |
| Iframe click → `windows.create({type: 'popup', url: extension page})` | Window created |

Caveat: in headless mode the very first call rejected with "Could not find an active browser window." although `windows.get` reported `focused: true`. After one `chrome.windows.update(windowId, {focused: true})` from the background, every scenario above behaved as listed. This looks like a headless artefact: a window that has just received a user click is active in a headed browser. **Not verified in headed Chrome.** Fullscreen behaviour may also depend on the platform. On macOS the toolbar can stay visible in fullscreen, which was not tested.

### 2. Firefox

**Behaviour on current Firefox (149+).** Bug 1799344, "Enable browserAction.openPopup without user interaction on all channels", landed for Firefox 149 (resolved 2026-02-12). Rob Wu (Mozilla) wrote: "The `action.openPopup` and `browserAction.openPopup` APIs are now available on non-Nightly channels from version 149, without requiring the user to set a pref" ([comment 17](https://bugzilla.mozilla.org/show_bug.cgi?id=1799344#c17)). MDN compat data: Firefox 109+, "Before Firefox 149, a user gesture is required to call this API" ([BCD](https://github.com/mdn/browser-compat-data/blob/c56acf2f789157f7e47688e353fb66db0475ecf1/webextensions/api/action.json)). The MDN page adds: "In Chrome and from Firefox 149, if the window ID is for an unfocused window, the API call is rejected" ([action.openPopup, 2026-03-19](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/openPopup)). Firefox 149 was released on 2026-03-24 ([release calendar](https://whattrainisitnow.com/calendar/)).

The implementation ([`ext-browserAction.js` `openPopup`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/browser/components/extensions/parent/ext-browserAction.js#L1092-L1126)) does the following:

- It throws "openPopup requires a user gesture" only if the pref `extensions.openPopupWithoutUserGesture.enabled` is false **and** the call is not handling user input. The pref now defaults to `true` ([`all.js`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/modules/libpref/init/all.js#L1768-L1769)).
- It rejects if the target window is not the focused window or is minimised: "Cannot show popup for an inactive window, only for the currently focused window." (bug [2011516](https://bugzilla.mozilla.org/show_bug.cgi?id=2011516), Firefox 149; [`ExtensionActions.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/toolkit/components/extensions/ExtensionActions.sys.mjs#L586-L588)).
- It rejects with "openPopup() cannot be called while another panel is open" (bug 1799347; [`throwIfOpenPopupIsBlockedByAnyAction`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/toolkit/components/extensions/ExtensionActions.sys.mjs#L269-L279)).
- If the button sits in the Extensions panel (not pinned), Firefox opens that panel first and then the popup ([`openPopup(window, …)`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/browser/components/extensions/parent/ext-browserAction.js#L497-L546)).
- It rejects with "No popup URL is set" or "Popup is disabled" when the active tab has no popup ([`getPopupUrl(tab, strict)`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/toolkit/components/extensions/ExtensionActions.sys.mjs#L188-L203)).
- **It can resolve without showing anything.** The internal `openPopup` returns quietly when the window has no widget node for the button, or when the button is already open. Bug [1811071](https://bugzilla.mozilla.org/show_bug.cgi?id=1811071) ("should resolve promise after showing popup") is still open. In Firefox a resolved promise therefore does **not** prove that the popup opened. Detect it positively instead, with a "popup loaded" message or `runtime.getContexts` (Firefox 127+).
- What happens in a `window.open` popup window or a fullscreen window is **not verified**: no Firefox was available, and the code path depends on whether the toolbar widget node exists in such windows.

**Firefox 109–148 (gesture required on release).** The gesture flag comes from the *calling* document. `callAsyncFunction` reads `context.contentWindow.windowUtils.isHandlingUserInput` and forwards it to the parent ([`ExtensionChild.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/toolkit/components/extensions/ExtensionChild.sys.mjs#L656-L677)). Any `moz-extension:` document in the extension process gets a full extension page context, whether it is top-level or a frame inside a web page ([`ExtensionPageChild.initExtensionContext`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/toolkit/components/extensions/ExtensionPageChild.sys.mjs#L349-L385)). MDN's [User actions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/User_actions) page [2026-03-10] lists "Clicking a button on a page bundled with the extension" as a user action. It also states that the status is lost after an `await`, and that a click in a web page relayed by message to the background "is not considered to be handling a user action".

- **Directly in the iframe, synchronously in the click handler:** should qualify. This is inferred from the source and from MDN's "page bundled with the extension" rule. It was **not run**: the MDN page does not mention the embedded-in-a-web-page case explicitly, and no Firefox was available.
- **Via `runtime.sendMessage` to the background:** does not qualify. The background's own document is not handling input. A developer reported exactly this on bug 1799344: "I send a message with `browser.runtime.sendMessage` to send a message to the background script to trigger the `browser.browserAction.openPopup` call … This works wonderfully in chrome, but I get a user gesture token error in firefox. The token seems to be lost in the message listener with or without the timeout" ([comment 4](https://bugzilla.mozilla.org/show_bug.cgi?id=1799344#c4), 2025-02-27).
- **After any `await` in the iframe handler:** does not qualify (MDN User actions).

**Which Firefox versions matter.** ESR 140 is the last ESR below 149, and it reaches end of life on 2026-10-13, when it "Updates to ESR 153" ([ESR status](https://whattrainisitnow.com/release/?version=esr)). After that, every supported desktop Firefox has the gesture-free behaviour. The pattern below (direct, synchronous call) still works on 109–148, so supporting older versions costs nothing.

**Manifest V3 note.** `action.openPopup` exists only in MV3 ("This API is available in Manifest V3 or higher", MDN). In Firefox both `action` and `browserAction` are served by the same implementation ([`ext-browser.json`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/browser/components/extensions/ext-browser.json#L8-L15)). Rimlock is MV3 everywhere, so it uses `browser.action.openPopup()`.

**Firefox for Android.** Not supported (bug [1817809](https://bugzilla.mozilla.org/show_bug.cgi?id=1817809), open), and the `windows` API does not exist there either ([BCD `windows.create`](https://github.com/mdn/browser-compat-data/blob/c56acf2f789157f7e47688e353fb66db0475ecf1/webextensions/api/windows.json)). Only the tab fallback works there.

### 3. Safari (not in the MVP)

- MDN compat data: `action.openPopup` supported from Safari 16, including Safari on iOS ([BCD](https://github.com/mdn/browser-compat-data/blob/c56acf2f789157f7e47688e353fb66db0475ecf1/webextensions/api/action.json)). A May 2026 comment in w3c/webextensions#160 says "Safari and Edge on iOS fully support `action.openPopup()`" ([comment](https://github.com/w3c/webextensions/issues/160#issuecomment-4378534714)).
- Apple's compatibility documentation does not mention `openPopup` ([Assessing your Safari web extension's browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)).
- A 2022 test of Safari 16 by Oliver Dunk (then at 1Password, later Chrome DevRel) found: no user gesture required, not callable from content scripts, popups of other extensions get closed, and when the button is hidden "Window focused, popup does not open" ([table](https://github.com/w3c/webextensions/issues/160#issuecomment-1127042759)). This is a third-party test, not Apple documentation.
- In WebKit, `actionOpenPopup` fails with "it is not implemented" when the embedding app cannot present popups programmatically, and with "another popup is already open" ([`WebExtensionContextAPIActionCocoa.mm`](https://github.com/WebKit/WebKit/blob/53667884624cdeb22d2110e1aa05c133cb19911d/Source/WebKit/UIProcess/Extensions/Cocoa/API/WebExtensionContextAPIActionCocoa.mm#L175-L187)). What Safari itself does is closed source.
- Bitwarden does not call `openPopup` on Safari. It asks its native app to "showPopover" instead ([`browser-actions.service.ts`](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/platform/actions/browser-actions.service.ts#L19-L38)). That is a hint that the web API was not reliable enough for them on Safari, but no reason is given.

### 4. Fallback and resume

#### Tab vs. popup window

| | Extension page in a tab (`tabs.create`) | `windows.create({type: 'popup'})` |
|---|---|---|
| Availability | Everywhere, including Firefox for Android and Safari on iOS | Chrome, Firefox desktop, Safari macOS. Not on Firefox for Android ([BCD](https://github.com/mdn/browser-compat-data/blob/c56acf2f789157f7e47688e353fb66db0475ecf1/webextensions/api/windows.json)) |
| Fit with #10 | Already a required surface ("the same UI can be opened in a browser tab"); #10 chose a tab over a detached window because it works the same in all three browsers | A third layout and lifecycle to support |
| Trust cue | Address bar shows the extension URL | Minimal chrome; on Chrome the bounds must be "at least 50% within visible screen space" or the call throws (BCD note) |
| Focus | Takes over the window; rimlock must re-activate the originating tab after unlock | Floats over the page; stays open on blur, unlike the action popup |
| Pitfalls | Loses the user's place unless rimlock switches back | Positioning on Linux/Wayland is unreliable (Bitwarden drops explicit coordinates there, see below); the window can get lost behind the browser; single-instance bookkeeping |
| `openPopup()` later | Works from it (normal window with a toolbar) | Fails inside it ("Browser window has no toolbar.") |

**Recommendation: the tab.** It reuses the adaptive UI from #10, it works on every target, and an extension tab is an extension-origin surface, so the rule "the Master password is typed only into rimlock's own UI" still holds. Open it next to the originating tab (`tabs.create({url, index: tab.index + 1, openerTabId: tab.id})`). After unlocking and finishing the pending action, close it and re-activate the originating tab and window. This is the same step Bitwarden takes after unlock (`focusWindow` + `focusTab`, see below).

#### Prior art: what the locked in-page UI does on click

- **Bitwarden** (`bitwarden/clients`). The locked Inline menu's unlock button and the notification bar's save when locked both call [`openUnlockPopout`](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/auth/popup/utils/auth-popout-window.ts#L27-L49), which opens `popup/index.html` via [`BrowserPopupUtils.openPopout`](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/platform/browser/browser-popup-utils.ts#L142-L183) as `windows.create({type: "popup", focused: true, width, height: 630})`, positioned near the top right of the sender window. On Linux, when the window reports `left === 0 && top === 0`, it skips positioning: "On Wayland, browser window coordinates are not being precisely reported". It does **not** use `action.openPopup` for this flow, although it does use it elsewhere ([`main.background.ts`](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/background/main.background.ts#L2159-L2170): keyboard command, web-vault request).
  - Resume: before opening the popout, the background records a `commandToRetry` together with the sender (tab) in an in-memory array, `lockedVaultPendingNotifications` ([`runtime.background.ts` L58](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/background/runtime.background.ts#L58), [`overlay.background.ts` `unlockVault`](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/autofill/background/overlay.background.ts#L2596-L2612), [`notification.background.ts` `handleSaveCipherMessage`](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/autofill/background/notification.background.ts#L1369-L1393)). On unlock it pops the item, closes the popout, focuses the sender's window and tab ([L335-L346](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/background/runtime.background.ts#L335-L346)), and replays the command: it saves the credentials, or reopens the Inline menu ([`handleUnlockCompleted`](https://github.com/bitwarden/clients/blob/7e12f4be44ef90a432c7cde128f875f6dcf72d22/apps/browser/src/autofill/background/notification.background.ts#L1832-L1855)). Closing the popout abandons the queue. Because the queue lives in service-worker memory, a worker restart in Chrome MV3 also loses it.
- **Proton Pass** (`ProtonMail/WebClients`, `applications/pass-extension`). The in-page dropdown handles lock states differently ([`Dropdown.tsx`](https://github.com/ProtonMail/WebClients/blob/84fdecb6a029ee102a2c1c9b01dcf1a420867c7f/applications/pass-extension/src/app/content/services/inline/dropdown/app/Dropdown.tsx#L80-L93)). A PIN-locked session shows a **PIN entry inside the in-page iframe** ([`DropdownPinUnlock`](https://github.com/ProtonMail/WebClients/blob/84fdecb6a029ee102a2c1c9b01dcf1a420867c7f/applications/pass-extension/src/app/content/services/inline/dropdown/app/components/DropdownPinUnlock.tsx)), the pattern #10 rejects for rimlock. A password-locked session shows a static item, "Open the extension to unlock.", whose click only closes the dropdown. No `openPopup` call appears in the extension or `packages/pass`.
- **1Password.** Closed source, and its first-party documentation does not describe what the locked inline menu does on click. Not covered.

#### How the pending save resumes

These are design consequences of the findings, not something a source prescribes.

- **Store the pending save when the Save prompt is shown, not on click.** The background puts `{tabId, origin, username, password, createdAt}` in `storage.session` before it shows the card. The click handler then has nothing to `await` before `openPopup()` (this matters on Firefox 109–148), and the popup can never load before the data exists. `storage.session` is memory-only, survives Chrome service-worker restarts and Firefox event-page unloads, is hidden from content scripts by default in Chrome and not exposed to them at all in Firefox, and is wiped on browser restart and on extension reload or update (see `docs/research/mv3-unlocked-state.md` on branch `research/mv3-unlocked-state`). Bitwarden's in-memory queue does not survive a worker restart; `storage.session` avoids that.
- **The extension iframe is a trusted context.** The Save prompt card can read `storage.session` and listen to `storage.onChanged` itself. It can show "Saved" or close itself when the pending item disappears, without a content-script relay.
- **The unlock surface finishes the job.** After a successful unlock, the popup (or the fallback tab) looks up the pending save for the active tab (or for the `tabId` passed in the fallback URL), saves the Entry, and removes the pending item. The popup does not need the background to stay alive across the unlock.
- **If the user abandons the unlock**, for example by blurring the popup, the pending item stays until it expires (a short TTL), until Lock, or until the browser restarts. The next time the popup opens it can offer "Save login for example.com?". The Auto-lock and Lock paths should clear pending saves together with the unlocked state.
- **Detecting failure:** in Chrome a rejected `openPopup()` is reliable. In Firefox the promise can resolve without a popup (bug 1811071), so the popup should announce `popupReady` on load. If that message has not arrived about 1 s after the call, the iframe asks the background to open the fallback tab. In Chrome and Firefox 149+ the background can do this without a gesture, and `tabs.create` needs none anywhere.

## Open risks

- **Headed Chrome not run.** The first-call "no active window" result in headless mode is assumed to be an artefact of headless mode.
- **Firefox not run at all.** Both the direct-from-iframe gesture on 109–148 and the behaviour in toolbar-less windows come from reading the source.
- **Login forms in site-opened popup windows** (OAuth or SSO sign-in) will always hit the fallback in Chrome, because the window has no toolbar. Firefox behaviour there is unknown.
- **Another extension's popup already open** makes the call reject in Chrome and Firefox 149+. The fallback covers this, but the user sees a tab instead of the popup.

## Sources

Primary documentation:

- Chrome: [chrome.action reference](https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup) [2026-09-11]; [What's new in Chrome extensions](https://developer.chrome.com/docs/extensions/whats-new) (Chrome 127 entry, 2024-06-19).
- MDN: [action.openPopup()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/openPopup) [2026-03-19]; [User actions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/User_actions) [2026-03-10].
- MDN browser-compat-data at `c56acf2f789157f7e47688e353fb66db0475ecf1`: [`action.json`](https://github.com/mdn/browser-compat-data/blob/c56acf2f789157f7e47688e353fb66db0475ecf1/webextensions/api/action.json), [`windows.json`](https://github.com/mdn/browser-compat-data/blob/c56acf2f789157f7e47688e353fb66db0475ecf1/webextensions/api/windows.json), [`runtime.json`](https://github.com/mdn/browser-compat-data/blob/c56acf2f789157f7e47688e353fb66db0475ecf1/webextensions/api/runtime.json) (`getContexts`: Chrome 116, Firefox 127, Safari not supported).
- Apple: [Assessing your Safari web extension's browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).
- Mozilla release data: [calendar](https://whattrainisitnow.com/calendar/), [ESR status](https://whattrainisitnow.com/release/?version=esr).

Source code:

- Chromium `76a9e5ddf3de5e65c610470a2e68aa23366659a8`: [`extension_action_api.cc`](https://github.com/chromium/chromium/blob/76a9e5ddf3de5e65c610470a2e68aa23366659a8/chrome/browser/extensions/api/extension_action/extension_action_api.cc), [`_api_features.json`](https://github.com/chromium/chromium/blob/76a9e5ddf3de5e65c610470a2e68aa23366659a8/chrome/common/extensions/api/_api_features.json), [`action.json`](https://github.com/chromium/chromium/blob/76a9e5ddf3de5e65c610470a2e68aa23366659a8/chrome/common/extensions/api/action.json#L386-L399).
- Firefox `3c71a541b0e7ac6e086907b38670dabca9174c45`: [`ext-browserAction.js`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/browser/components/extensions/parent/ext-browserAction.js), [`ExtensionActions.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/toolkit/components/extensions/ExtensionActions.sys.mjs), [`ExtensionChild.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/toolkit/components/extensions/ExtensionChild.sys.mjs), [`ExtensionPageChild.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/toolkit/components/extensions/ExtensionPageChild.sys.mjs), [`all.js`](https://github.com/mozilla-firefox/firefox/blob/3c71a541b0e7ac6e086907b38670dabca9174c45/modules/libpref/init/all.js#L1768-L1769).
- WebKit `53667884624cdeb22d2110e1aa05c133cb19911d`: [`WebExtensionContextAPIActionCocoa.mm`](https://github.com/WebKit/WebKit/blob/53667884624cdeb22d2110e1aa05c133cb19911d/Source/WebKit/UIProcess/Extensions/Cocoa/API/WebExtensionContextAPIActionCocoa.mm#L175-L187).
- Bitwarden `bitwarden/clients` `7e12f4be44ef90a432c7cde128f875f6dcf72d22` (files linked inline).
- Proton Pass `ProtonMail/WebClients` `84fdecb6a029ee102a2c1c9b01dcf1a420867c7f` (files linked inline).

Bug trackers and standards discussion:

- Bugzilla: [1799344](https://bugzilla.mozilla.org/show_bug.cgi?id=1799344) (gesture requirement removed, Firefox 149), [2011516](https://bugzilla.mozilla.org/show_bug.cgi?id=2011516) (reject for non-focused windows, Firefox 149), [1799347](https://bugzilla.mozilla.org/show_bug.cgi?id=1799347) (reject when another panel is open), [1811071](https://bugzilla.mozilla.org/show_bug.cgi?id=1811071) (promise resolves before the popup shows, open), [1817809](https://bugzilla.mozilla.org/show_bug.cgi?id=1817809) (Android support, open).
- WebExtensions Community Group: [w3c/webextensions#160](https://github.com/w3c/webextensions/issues/160) "Ensure consistency of `action.openPopup` API across browsers", especially the [2022 Chrome/Safari table](https://github.com/w3c/webextensions/issues/160#issuecomment-1127042759) and the [2026 Chrome 143 / Firefox 148 / 149 table](https://github.com/w3c/webextensions/issues/160#issuecomment-3774666519).
