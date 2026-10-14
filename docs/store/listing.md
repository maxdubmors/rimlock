# Store listing copy

Text for the Chrome Web Store and AMO listings and for their review forms. Before every submission, check it against the built `manifest.json` (CI publishes it as an artifact): every permission in the manifest must have a justification here, and nothing here may describe a permission the manifest lacks. Source decisions: [ADR-0013](../adr/0013-permissions-frozen-required-set.md), [Decide the permissions strategy](https://github.com/maxdubmors/rimlock/issues/25). Privacy policy: [`PRIVACY.md`](../../PRIVACY.md).

## Shared

**Name:** rimlock

**Summary** (CWS limit 132 characters; AMO limit 250):

> Fill and manage passwords from your own KeePass database. Works with KeePassXC and others on the same file. No account, no cloud.

**Description:**

> rimlock is a password manager for your browser that works directly on your own KeePass database (.kdbx). Your file stays the single source of truth: keep using KeePassXC, Strongbox, KeePassDX or KeePass on the same file, even at the same time.
>
> • Open a database from a file on your computer or from your own WebDAV server (Nextcloud, ownCloud/oCIS, Apache, rclone and others).
> • Unlock with your Master password and Key file. rimlock locks again automatically after a time you choose, when your computer is idle or locked, and when the browser closes.
> • See the logins that match the site you are on, and fill them with one click or a keyboard shortcut. rimlock never fills anything until you ask.
> • Save new logins and update changed passwords right after you submit a form.
> • Generate strong passwords and passphrases.
> • Edit entries and groups, use the Recycle Bin, browse entry history, and fill one-time codes (TOTP).
> • Copy values; rimlock clears them from the clipboard after 30 seconds.
>
> Changes made elsewhere are merged, never overwritten, using the same rules as KeePassXC. rimlock writes only what you changed and keeps everything else in the file exactly as other apps left it.
>
> Private by design: no account, no servers, no telemetry. rimlock talks to nothing except the WebDAV server you configure, and only sends it your encrypted database.
>
> Free and open source under the GPL-3.0: https://github.com/maxdubmors/rimlock
>
> Not yet supported: hardware keys (YubiKey) for opening a database, attachments, passkeys, and creating a new database (use KeePassXC for these).

**Category:** CWS: Tools (Productivity). AMO: Privacy & Security.

**Homepage / support:** https://github.com/maxdubmors/rimlock (issues for support).

**Privacy policy URL:** https://github.com/maxdubmors/rimlock/blob/main/PRIVACY.md

## Chrome Web Store: Privacy practices tab

**Single purpose:**

> Fill and manage passwords from the user's own KeePass database.

**Permission justifications:**

| Permission | Justification |
|---|---|
| Host access (`http://*/*`, `https://*/*`) | Detects login forms on the sites the user visits to show matching entries and fill them on request, and to offer saving a submitted login. |
| `storage` | Stores settings, the encrypted local copy of the user's database and session-only unlock state. |
| `unlimitedStorage` | Keeps the encrypted local copy of the user's database, which can exceed the default quota and must not be evicted. |
| `idle` | Locks the database when the computer is idle or the screen is locked. |
| `alarms` | Locks the database after the configured timeout and retries syncing with the user's WebDAV server. |
| `scripting` | Injects the form-filling script into tabs that were already open when the extension was installed or updated, and fills on sites where the user restricted access. |
| `activeTab` | Lets the popup show and fill entries for the current tab when the user has restricted site access. |
| `offscreen` | Keeps the user-granted handle to the KeePass file open so changes can be written back, and clears copied passwords from the clipboard. |
| `clipboardRead`, `clipboardWrite` (optional) | Clears a copied password from the clipboard after a delay, only if it is still there. |
| `privacy` (optional) | Turns off the browser's own password saving when the user asks rimlock to be the password manager. |

**Remote code:** No. All code, including the WebAssembly module, is in the package.

**Data usage**, items to tick:

- **Authentication information**: passwords, user names, one-time codes from the user's database, and logins the user submits on web pages.
- **Website content**: the structure of forms on pages the user visits, read locally to find login fields.

Certifications, all three ticked:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

All data is handled on the user's device; the only transfer is the encrypted database to a WebDAV server the user configures.

## AMO

**`data_collection_permissions`:** `["none"]` (in the manifest). Nothing reaches the developer or any third party.

**Notes to reviewer:**

> rimlock is a KeePass client. The only network traffic is the encrypted .kdbx going to a WebDAV server the user configures; there are no developer servers, analytics or remote code.
>
> The WebAssembly module (rimlock-core) is built from the Rust sources in crates/. Build instructions are in BUILDING.md at the root of the source package; the build is reproducible and the expected SHA256SUMS are listed there. Third-party JavaScript is unmodified npm packages pinned in pnpm-lock.yaml, including the form classifier @protontech/autofill (MPL-2.0).
>
> To test: create a KeePass database in KeePassXC (or use the test database attached), open the rimlock popup, choose "Add a Database", import the file and unlock with the password given below.

Attach a small test database with a known password to each submission; never a real one.

## Screenshots (M5)

1. Popup on a site: Matches and search.
2. The Inline menu under a login field.
3. The Save prompt card.
4. The Entry editor.
5. The Password generator.

Use a generated test Database; no real data.
