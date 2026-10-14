# Autofill: form detection, Match, the Inline menu, Fill and the Save prompt

Principles: [ADR-0009](../adr/0009-form-detection-via-proton-classifier.md) (Proton's classifier behind `FormDetector`), [ADR-0006](../adr/0006-composite-key-only-in-popup-or-tab.md) (no unlock in a page), [ADR-0013](../adr/0013-permissions-frozen-required-set.md) (site access). Security invariants: [`security.md`](security.md).

## Form detection

- **Proton's `@protontech/autofill`**, an exact-pinned and unmodified npm dependency, classifies fields: username, current password, new password, sign-up identifier, OTP. Remote per-site rules and model downloads stay off.
- It sits behind a rimlock-owned **`FormDetector`** interface. Nothing else in the Extension imports Proton's types.
- **Shadow DOM:** rimlock walks shadow roots itself, closed ones included (`chrome.dom.openOrClosedShadowRoot` / `element.openOrClosedShadowRoot`; filter to `HTMLElement` first, because it throws on `<svg>`), and feeds each root to the classifier. It re-implements `shouldRunClassifier()` per root.
- **Fields split across roots** (each `<input>` in its own root, as on Reddit): a field alone in its root gets Proton's cluster flag (`flagCluster`), and fields alone in their form are grouped with nearby fields across root boundaries. The group's purpose is set from its field types: a new password makes it a sign-up, a current password a login.
- The walk uses exported but undocumented internals (`flagCluster`, `selectFormCandidates`, `isProcessableField`, …). The shadow-DOM fixtures are the regression suite for every Proton bump.
- Known gap: a split form whose only visible field is an identifier (Reddit's sign-up step 1) gets no purpose.
- **Proton classifies; rimlock decides.** rimlock owns the mapping from labels to actions, the fill-time visibility, honeypot and gesture checks, and any per-site override.
- Fallback if the walk ever falls short: a vendored, patched Proton copy (deferred, ADR-0009).

## Match

The matcher is TypeScript (`matching/`, derived from Bitwarden's) and reads `MatchingInfo` from `EntrySummary`, which the Core has already normalised ([`interop.md`](interop.md)).

- **KeePassXC parity:** the page host equals the Entry host or is a subdomain of it.
- **Public Suffix List-aware:** an Entry for a public suffix Matches nothing; `a.github.io` never Matches `b.github.io`.
- A URL in double quotes (`"…"`) Matches exactly. `*` wildcards work in additional URLs.
- The port must match. An `https` Entry is never offered on an `http` page.
- **Ranking:** exact host first, then parent domain.
- **Hidden** if any signal hides the Entry: `BrowserHideEntry`, KeePassXC Group tri-states, `KeePassXC-Browser Settings` `Deny` (for the denied hosts), Strongbox `KPEX_DoNotSuggestForAutoFill`, Kee `Hide`/`blockedUrls`, `BrowserOnlyHttpAuth`, or the Entry being in the Recycle Bin. **Not** `AutoType/Enabled=false`. `Allow` is ignored (there is no access-confirmation dialog).
- Kee `regExUrls` are ignored.
- **Badge:** the toolbar badge shows the number of Matches for the current tab, always (no setting). `!` replaces it for Sync errors that need action.

## The Inline menu

**When it opens by itself:** when a login field gets focus, **only if it has something to offer**:

- Matching Entries;
- the Locked state ("Click to unlock" opens the popup);
- the generator, on a new-password field only (sign-up or password change), unless turned off in Settings;
- TOTP codes, on an OTP field.

Otherwise it stays closed. The rimlock field icon still opens it on click.

**With no Matches**, its icon offers **Search in rimlock**, which opens the popup. The Inline menu never searches the whole Database.

**Isolation:**

- Closed shadow host → extension-origin iframe → top layer (`popover`). The same in Chrome and Firefox.
- The iframe never reads `storage` (Firefox gives it only content-script privileges). It talks to the background over a port and receives display data only: title, username, Database icon. No site favicons.
- Fill goes iframe → background → the content script of the target frame.
- Clickjacking: Proton's `TopLayerManager` pattern. Re-assert top-most, a 150 ms poison window after show or move, and checks on ancestor opacity, filter and visibility. A residual risk, accepted.

**Keyboard:** ↓ from the field moves focus into the menu, ↑/↓ select, Enter Fills (a user action inside the extension-origin iframe), and Esc closes the menu and returns focus to the field.

**Locked:** "Click to unlock" calls `action.openPopup()` synchronously as the first statement of the iframe's click handler, with no `await` before it and no detour through the background. If it fails (a window without a toolbar, fullscreen, another popup open; in Firefox the promise may resolve with no popup, so the popup reports "ready"), the same UI opens in a tab next to the page, which is closed after the unlock and the originating tab refocused. After the unlock the popup shows the Matches; the Fill is not replayed.

**Setting:** with **Show the Inline menu** off, the content script still runs (Fill by shortcut and submit detection need it); only the menu UI is suppressed.

## Fill

**Triggers:**

- a click (or Enter) on an Entry in the Inline menu;
- **Fill** on a Match in the popup;
- the **Fill shortcut** (Alt+Shift+U), which opens the Inline menu on the focused field and Fills at once if there is exactly one Match ([`generator-and-copy.md`](generator-and-copy.md)).

**Never auto-submit.**

**Fill-time checks:** the field is visible and not a honeypot; it is in the same frame and origin as when the menu opened; there was no navigation since. Only fields of the same form are filled. Credentials come from the Core's per-use `fill` command, with placeholders resolved by the Core, and stay in the page DOM no longer than the Fill.

**Frames:** candidates are Matched against the frame's own URL. In a frame from another site (eTLD+1) than the tab, the Inline menu never opens by itself, only on a click on the rimlock field icon (or the Fill shortcut), and it says "Fill into *host*".

**Multi-step logins:** the Entry chosen on the identifier step is remembered per tab + site for 5 minutes in `storage.session`. The identifier step gets the username only. On the password step the Inline menu ranks that Entry first and highlights it, still filling only on click.

**TOTP:** on an OTP field the Inline menu offers the current code of matching Entries with TOTP (the remembered Entry first). Codes split over several inputs are spread digit by digit. Nothing is copied to the clipboard automatically.

**Non-matching Entry from the popup:** Fill needs an explicit confirmation, "*Entry URL* doesn't match *site*", with an option **Also use this Entry on *site*** that adds the site as a URL to the Entry (`KP2A_URL*`, [`interop.md`](interop.md)).

**Without site access** (withheld in Chrome or revoked in Firefox): there are no content scripts, so no Inline menu and no Save prompt on that site. The popup still shows the Matches through `activeTab` and Fills through a one-off `scripting` injection. The popup banner offers **Allow on this site** / **Allow on all sites** ([`manifest-and-permissions.md`](manifest-and-permissions.md)).

## The Save prompt

**Submit detection** is page-side only: form `submit`, a click on the submit button, Enter in a field. No `webRequest`. The captured values go to the background at once and wait in `storage.session` as a **pending save**. The prompt shows after the navigation, or when the form disappears. Accepted cost: an occasional prompt after a failed login.

**What it offers:**

| Situation | Prompt |
|---|---|
| Same username, different password | **Update** (the old password goes to History) |
| No Match with that username | **Save new** |
| Identical password | no prompt |
| Password change (current + new) | **Update** the Entry whose password equals the current one, else let the user pick (`passwordEquals`) |
| Sign-up | **Save new** |
| Password-only form | **Update** if exactly one Match, else pick |

- A new Entry gets Title = host without `www.`, URL = page origin, Username, Password.
- **Where:** the root Group by default. A Group picker in the card remembers the last choice per Database (shared with New Entry in the popup).
- **Never for this site** adds the site (the registrable domain) to the Never-save sites in Settings, not to the `.kdbx`. With **Offer to save logins** off, no prompt is shown anywhere.

**The card** is an in-page card near the toolbar icon, in the same isolation as the Inline menu (closed shadow host, extension-origin iframe, top layer).

**When Locked:** the card offers **Unlock and save**, which opens the popup exactly as "Click to unlock" does (tab fallback included). The pending save waits in `storage.session` from the moment the card is shown, and the surface that unlocks completes it and clears it. The card watches `storage.onChanged` and closes. Every Lock clears pending saves.

**Generated passwords:** once the generator fills a field from the Inline menu, the password becomes a pending save tied to the site, by the same mechanism. If no Save prompt follows, the popup on that site shows "Unsaved generated password for *site*". It is dropped on save, on dismissal, on Auto-lock and on browser restart. No Entry is created at generation time.

## Content-script rules

- Content scripts never touch `storage`: they ask the background ("is the Inline menu on?", "is this a Never-save site?"). Enforced by lint rules everywhere and by `storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})` on every background start in Chrome ([`settings.md`](settings.md)).
- Content scripts are idempotent (they may be injected twice) and remove their UI when the connection to the background is lost ("Extension context invalidated").
- Content-side code (`autofill/`, the content and inline-menu entrypoints) never imports `background/`, `sources/`, `core-bindings/` or `settings/` ([`engineering.md`](engineering.md)).
- Keep the `content` bundle small: a new runtime dependency there needs the owner's decision.

Decision detail: [Decide the autofill approach](https://github.com/maxdubmors/rimlock/issues/15), [Verify Proton classification across shadow roots](https://github.com/maxdubmors/rimlock/issues/24), [Opening the popup from in-page UI in Chrome and Firefox](https://github.com/maxdubmors/rimlock/issues/23). Facts: [Compare form-detection engines: Proton classifier vs Bitwarden heuristics](https://github.com/maxdubmors/rimlock/issues/17), [Autofill engine prior art](https://github.com/maxdubmors/rimlock/issues/5).
