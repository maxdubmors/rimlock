# Password generator, Copy and keyboard shortcuts

## Password generator

The generator needs no Database and never reads from or writes to one by itself. It works while Locked.

**Modes:** characters (the default) and **Passphrase**. The last used mode is remembered.

**Characters**

- Length 8–128, default **20**.
- Toggles: `A-Z`, `a-z`, `0-9`, symbols, **Avoid look-alike characters** (`0O1lI|`).
- Default: letters + digits, symbols off (~119 bits).
- Every enabled class appears at least once.
- The symbol set is fixed: `!#$%&*+-.=?@^_~` (15 characters; no quotes, backslash, brackets, `<>`, backtick, `|`, `/`, `:`, `;`, `,`). No custom character set.

**Passphrase**

- The EFF large wordlist (7776 words, ~12.9 bits per word, CC BY 3.0 US, attributed in `NOTICE`), bundled and loaded lazily by the generator UI only.
- 3–20 words, default **5** (~64.6 bits), separator `-`, toggles **Capitalize** and **Add a number**.
- English only in the MVP.

**Settings:** one global `GeneratorOptions`, which is simply the last used options. It is a serialisable object, so named profiles can come later. No profiles and no per-site settings in the MVP. `GeneratorOptions` are changed in the generator itself, not on the Settings screen.

**Site rules:** the field's `maxlength`/`minlength` and its `passwordrules` attribute (Apple/WICG syntax) adjust the options **for that one generation only**, shown as "Adjusted to this site's rules". The saved options are untouched. If a Passphrase cannot meet the rules, that generation uses characters. Symbols that `passwordrules` allows beyond the fixed set are allowed for that generation. `pattern` is ignored. No bundled per-site quirks database.

**Randomness:** `crypto.getRandomValues` only; indices by rejection sampling (no modulo bias). The class guarantee is enforced by regenerating the whole password, so the result is uniform over valid passwords. The generator is a pure, stateless function `generate(options, rng)` in `generator/` with an injectable `rng` for tests. The popup and the background both call it.

**No history:** unused passwords are stored nowhere. A password filled from the Inline menu becomes a pending save ([`autofill.md`](autofill.md)).

**Strength:** exact entropy in bits from the options, with a label: weak below 60, good below 90, strong above. No estimate for hand-typed passwords.

**Surfaces**

- **Popup Generator tab:** the password, **Regenerate**, **Copy**, the options below.
- **Entry editor:** a button on the Password field opens the same generator as a panel; **Use** writes into the Draft.
- **Inline menu** on a new-password field: one row "Use generated password" with the password visible and **Regenerate**. A click Fills the new-password field and the confirm field of the same form, then creates the pending save. Options are not editable there; **Options…** opens the popup.

## Copy

**What can be copied** (from the popup or the tab only, **never from the Inline menu**):

- In the Entry view: Username, Password, the TOTP code, each URL, each custom field (hidden ones included) and Notes as a whole.
- In a History version: the same actions for its fields.
- On list rows: username, password, and the TOTP code ([`popup.md`](popup.md)).
- In the generator: the password.

**Keyboard in the popup** (KeePassXC layout): on a selected row or an open Entry, Ctrl/⌘+C copies the password, Ctrl/⌘+B the username and Ctrl/⌘+T the TOTP code. This applies only when no text is selected in an input; otherwise the keys copy normally. There is no Ctrl+U; URLs are copied with their button.

**After Copy** the popup stays open with a toast: "Password copied · clears in 30 s", or "Copied · won't be cleared" when clearing is off or its permission was refused. Copying a masked value does not reveal it. Copy never touches the file.

## Clipboard clearing

- **Scope:** everything rimlock copies, under one timer.
- **Default:** on, **30 s**. Settings: on/off and 10 s / 30 s / 1 min / 2 min / 5 min, next to the note "Clipboard managers and Windows clipboard history may keep copied values; prefer Fill."
- **Any Lock** (manual, Auto-lock, switching Database) clears at once.
- **Only our value is cleared.** A new rimlock Copy replaces the tracked value and restarts the timer. Something the user copied elsewhere is left alone.
- **It survives a background teardown:** the expected value is kept as a **SHA-256 hash in `storage.session`** (never the plaintext), so a background that wakes up can hash the clipboard and compare.
  - **Chrome:** the offscreen document runs the timer with `setTimeout` and reads and writes through `execCommand` on a textarea (`navigator.clipboard` needs focus, which an offscreen document never has).
  - **Firefox:** `alarms` wake the event page, which uses `navigator.clipboard`.
  - The value written to clear is an implementation detail; Chrome's `execCommand` rejects an empty string.
- **Permission at the first Copy:** the popup writes the clipboard, sends the hash to the background, then calls `permissions.request` for `clipboardRead` + `clipboardWrite`. In Chrome it awaits the write first; in Firefox it must not await, or the request loses user activation. The background schedules the clear on `permissions.onAdded`, so the first Copy is cleared too. After a refusal rimlock never asks again on Copy; Settings offer **Enable clipboard clearing**. With clearing switched off, Copy requests nothing.
- **Accepted residual risks:** if the browser closes or the Extension updates before the timer, the value stays on the clipboard. A WebExtension cannot mark clipboard data as concealed, so clipboard histories may keep it.

## Keyboard shortcuts

Manifest `commands`:

| Command | Default (Windows/Linux) | Default (macOS) |
|---|---|---|
| `_execute_action` (open the popup) | Alt+Shift+K | MacCtrl+Shift+K |
| `fill` | Alt+Shift+U | MacCtrl+Shift+U |
| `lock` | unbound | unbound |

- Rejected defaults: Ctrl+Shift+L (a Chrome accelerator), Ctrl+Shift+Y (Firefox Downloads on Linux), Ctrl+Shift+K (Firefox Web Console), Alt+Shift+P (Chrome "new tab group"). With KeePassXC-Browser installed first, rimlock's Fill key stays unassigned; Settings say so.
- **Fill shortcut behaviour:** opens the Inline menu on the focused field and Fills at once if there is exactly one Match. No focused field → the first login form the `FormDetector` sees, else open the popup. Locked → `action.openPopup()`; after the unlock the popup shows the Matches and the Fill is not replayed. No site access → open the popup (a command grants `activeTab`). Focus in a cross-site frame → the shortcut counts as the click, and the menu says "Fill into *host*".
- **Shown, never hard-coded:** Settings list the current keys from `commands.getAll()`, flag "Not set — another extension or the browser uses it", and link to the browser's shortcut page (`commands.openShortcutSettings()` in Firefox, `chrome://extensions/shortcuts` in Chrome). Tooltips such as "Fill (Alt+Shift+U)" also come from `getAll()`.

Decision detail: [Decide the password generator](https://github.com/maxdubmors/rimlock/issues/29), [Decide copying, clipboard clearing and keyboard shortcuts](https://github.com/maxdubmors/rimlock/issues/30).
