# The popup and the tab: one adaptive UI

One Svelte app serves the toolbar popup, the same UI opened in a tab, and the options page. Interop rules behind every edit: [`interop.md`](interop.md). Core calls: [`core-api.md`](core-api.md) § 4–5.

## Surfaces

- The **toolbar popup is primary and complete.** Unlock, Matches, search, viewing, editing and creating Entries, Group navigation, the Recycle Bin and the generator all work inside it. No common task requires leaving it.
- **The same UI opens in a tab** for bulky work (a new Group, moving many Entries). Same screens, adaptive layout: one column with stacked navigation in the popup; list and detail side by side when wide. Multi-select and "Move to…" exist in both layouts.
- Also a tab: the welcome tab, adding a Database, Firefox import and Re-import…, **Unlock in a tab…**, and the fallback when `action.openPopup()` fails.
- There is no side panel, no detached window and no separate manager UI.
- Theme follows `prefers-color-scheme`. English only, but every string goes through i18n ([`engineering.md`](engineering.md)).

## Navigation

- **Header:** the Database name (opens the Database list and "Add a Database"), Lock, and the Settings gear.
- **Home** (search-first): the current site's Matches on top, then search. Focus starts in search. Home search never shows Recycle Bin contents.
- **Browse:** the Group tree, with the Recycle Bin at the end.
- **Generator:** its own tab ([`generator-and-copy.md`](generator-and-copy.md)).
- **Status line**, always visible: the Sync status of the current Database ([`sources.md`](sources.md)), or for Firefox imports "Imported *date* · *N* changes not exported" with **Export…** / **Re-import…** ([`sources.md`](sources.md) § Firefox: imported copy, also for a missing Local copy).
- Banners: "rimlock can't see this site" with **Allow on this site** / **Allow on all sites** ([`manifest-and-permissions.md`](manifest-and-permissions.md)); "Unsaved generated password for *site*" ([`autofill.md`](autofill.md)); notices after a lock.

## List rows (Home, search, Browse)

- Row actions: **Fill** (Matches only), copy username, copy password, and a click on the live TOTP code to copy it. A click on the row opens the Entry. If the buttons do not fit at popup width, copy username moves into the row's `⋯` menu.
- Keyboard: ↑/↓ select a row; Enter = Fill if the row is a Match, else open the Entry; Esc = back. Ctrl/⌘+C, +B, +T: [`generator-and-copy.md`](generator-and-copy.md).
- Filling a non-matching Entry needs a confirmation ([`autofill.md`](autofill.md)).

## Entry view

Shows every field with copy actions, the live TOTP code, the URL list, tags, custom fields (hidden ones masked with reveal), Notes, Expiry, icon, and the "Don't offer in browser" state plus any read-only hiding signals with their source. **History** and **Edit** are actions here. Entry content is rendered as text, never as HTML; only `http(s)` URLs are opened.

## Entry editor

1. View → **Edit** → form → **Save** / **Cancel**. One Save = one `UpdateEntry` = one History version. No per-field autosave. Save is disabled while nothing changed.
2. **Fields:** Title; Username; Password (reveal, and a generator button that opens the generator as a panel, whose **Use** writes into the Draft); one URL list without keys (the first is `URL`, the rest `KP2A_URL*`); Notes; Tags (chips with autocomplete from existing tags); Custom fields; TOTP; Icon (standard-icon picker; custom icons are shown, never created); Expiry (a date or never); **Don't offer in browser**.
3. **New Entry** from Home with a site open: Title from the site, URL = the page origin, Group = the last used one (per Database, shared with the Save prompt). From Browse: the current Group. A new Entry is a Draft too.
4. **Save is blocked only by real errors:** an unparseable TOTP; a reserved or duplicate custom-field key; `,` `;` `:` in a new tag. An empty Title is allowed and shown as "(no title)". URLs are not validated and no scheme is added.

**Custom fields**

- Keys rimlock interprets (`KP2A_URL*`, `URL_n`, `URL-*`, `URL <n>`, `otp`, `TimeOtp-*`, `TOTP Seed`/`TOTP Settings`, `KPRPC JSON`) are hidden from the custom-field list; they show as URLs or TOTP.
- Creating or renaming a field to one of those keys, a standard key (`Title`, `UserName`, `Password`, `URL`, `Notes`) or an existing key is refused (`InvalidChange: ReservedKey | DuplicateKey`).
- Every field has a "hidden" (`Protected`) toggle, off by default for new fields. Values may be multi-line. File order is kept.

**TOTP**

- One input that takes a Base32 secret **or** an `otpauth://` URI, plus a collapsed **Advanced** section: digits, period, algorithm, Steam.
- A **live code** shows before Save.
- The "two different TOTP secrets" warning with **Use this one** ([`interop.md`](interop.md)).
- No QR scanning in the MVP.

## Drafts

1. **One Draft per Unlocked Database**, written to `storage.session` on every change. The popup and the tab share it. Closing the popup just keeps it.
2. **Edit** on another Entry while a Draft exists asks "Unsaved edits to *A*: **Return** / **Discard**".
3. **Back** inside the UI with changes asks **Save** / **Discard** / **Keep editing**. Nothing is asked when unchanged.
4. **Manual Lock** and **switching Database** with a Draft ask **Save** / **Discard** / **Cancel**.
5. **Auto-lock** discards the Draft silently. Only its Entry UUID is kept as `draftDiscardedBy: 'auto-lock'`, and after the next unlock the popup says "Unsaved edits to *X* were discarded when the Database locked". A Draft is never saved to the file automatically.
6. **Sync changed the Entry under a Draft:** a banner "Changed on another device" appears as soon as the Merge lands. Save then fails with `EntryChanged` and offers **Overwrite** (no extra confirmation; the other version stays in History) / **Discard my edits** / **Show their version** (read-only). If the Merge deleted or recycled the Entry: **Save as new Entry** / **Discard**. No field-level diff or merge.

## Delete, Recycle Bin, Undo

- **Delete** = Recycle at once, no dialog, then a toast "Moved to Recycle Bin · **Undo**" (`RestoreEntries`). **Move** gets the same Undo toast.
- Permanent delete (from the Recycle Bin, or with `RecycleBinEnabled=false`) always asks for confirmation.
- **The Recycle Bin** (under Browse) is read-only: Entries can be viewed, not edited. Actions: **Restore**, **Delete permanently**, **Empty Recycle Bin** (confirmed with counts). It has its own search.
- **Restore** goes to `PreviousParentGroup`. If that Group is gone, a Group picker opens instead of silently using the root.

## Groups

- Actions from a Group's `⋯` menu in Browse: **Create**, **Rename**, **Move to…**, **Delete**.
- Editable: name and icon only. Group notes are preserved; KeePassXC browser settings on a Group are shown read-only.
- **Move to…** opens one Group picker, for Entries and Groups, in both layouts. A Group's own subtree is disabled as a target. No drag-and-drop.
- **Delete** a Group recycles the whole subtree (`RecycleGroup`), confirmed with "*N* Entries, *M* Groups".
- The root Group cannot be renamed, moved or deleted. The Recycle Bin can only be emptied.

## Multi-select

Structural only: **Move to…** and **Delete** (Recycle); in the Recycle Bin also **Restore** and **Delete permanently**. No bulk field edits. In both layouts; the popup uses a checkbox mode.

## History

- A list of versions with their date and the **names of the fields that changed** (computed by the Core, secret fields included, values never).
- A version opens read-only, with reveal and copy of its secrets.
- **Restore this version** (the current one goes to History) and **Delete version** (confirmed).
- No side-by-side comparison.

Decision detail: [Sketch the Extension UI shape](https://github.com/maxdubmors/rimlock/issues/10) (prototype on branch `prototype/extension-ui-shape`), [Decide the editing flows for Entries and Groups](https://github.com/maxdubmors/rimlock/issues/28).
