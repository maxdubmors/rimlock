# Settings

Settings are the user's choices about how the Extension behaves. They stay on the device and are never written into a Database.

## Where they live

- Everything is in **`storage.local`**. Nothing goes to `storage.sync`. There is no export/import and no enterprise policy (`storage.managed`) in the MVP.
- The Local copy is in IndexedDB and the Unlocked state in `storage.session`; neither counts as Settings.

## Global vs per-Database

| Global | Default | Spec |
|---|---|---|
| Auto-lock T1 / T2 / T3 | 1 h / on / 15 min | [`databases-and-unlock.md`](databases-and-unlock.md) |
| Clear clipboard, and after how long | on, 30 s | [`generator-and-copy.md`](generator-and-copy.md) |
| `GeneratorOptions` (the last used options) | characters, 20, letters + digits | [`generator-and-copy.md`](generator-and-copy.md) |
| Offer the generator in the Inline menu | on | [`autofill.md`](autofill.md) |
| Show the Inline menu | on | [`autofill.md`](autofill.md) |
| Offer to save logins | on | [`autofill.md`](autofill.md) |
| Never-save sites | empty | below |
| Last unlocked Database | — | [`databases-and-unlock.md`](databases-and-unlock.md) |

| Per-Database (deleted with the Database) |
|---|
| Source config: WebDAV URL + credentials (`storage.local`); the Chrome file handle lives in IndexedDB next to the Local copy, because it is not JSON-serialisable ([`sources.md`](sources.md)) |
| Remembered Key file (the processed 32-byte component) |
| Last Group used by the Save prompt and New Entry |

- There is no per-Database Auto-lock.
- **Never-save site:** keyed by site = the registrable domain via the PSL, the same unit as Match. Added only from the Save prompt ("Never for this site"); removed in Settings, one at a time or with **Clear list**. It cannot be added by hand.

## Storage shape and behaviour

- **Sparse:** only values the user changed are stored; defaults live in code, so a changed default reaches everyone who never touched that setting.
- The record is **versioned** and **validated by a schema on read** (`settings/`: schema, defaults, migrations). An invalid value falls back to its default.
- **Applies at once, everywhere:** the background relays `storage.onChanged` to open pages. Changing a setting while Unlocked counts as use for Auto-lock.
- **Editable while Locked**, with no Master password check. Per-Database actions (Forget Key file, edit WebDAV credentials, Remove) also work while Locked.
- **Reset all settings** (one button, confirmed) clears the global overrides only. It leaves the Never-save list, the Databases and their data, and granted permissions alone.

## Content scripts never touch `storage`

- Content scripts ask the background for what they need.
- In Chrome, every background start calls `storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})` ([`verification.md`](verification.md) V10).
- Firefox cannot restrict `storage.local`, so lint rules ban `storage` in content-side code in both browsers ([`engineering.md`](engineering.md)).
- Recorded residual risk: a compromised renderer in Firefox can read `storage.local` (WebDAV credentials, the remembered Key file, Never-save sites). This stays within [ADR-0002](../adr/0002-security-baseline.md).

## The Settings screen

- The gear in the popup header opens the **Settings** section of the adaptive UI.
- `options_ui` points at its own WXT entrypoint, `options.html`, which mounts the same Svelte app on the Settings route with `open_in_tab: true`.
- Sections:
  - **Security:** Auto-lock T1/T2/T3; clipboard clearing (or **Enable clipboard clearing** after a refusal), with the clipboard-history note.
  - **Autofill:** Show the Inline menu; Offer the generator in the Inline menu; Offer to save logins; the Never-save sites list; **Turn off the browser's password saving** (`privacy`, which sets only `privacy.services.passwordSavingEnabled`); the site-access status with **Allow on all sites**.
  - **Databases:** the list, then a page per Database with its Source, WebDAV credentials, **Forget Key file** and **Remove**.
  - **Shortcuts:** read from `commands.getAll()`, with "Not set" flags and a link to the browser's shortcut page.
  - **About:** version, licences (`NOTICE`), `PRIVACY.md`.
- Not in Settings for the MVP: theme, language, Match tuning, per-Database Auto-lock, per-site "hide the Inline menu".

Decision detail: [Decide where Extension settings live and whether they sync](https://github.com/maxdubmors/rimlock/issues/31).
