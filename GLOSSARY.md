# rimlock

A browser-first client for KeePass databases that aims for the convenience of hosted password managers while keeping the user's `.kdbx` file as the single source of truth.

## Language

### Data

**Database**:
A KeePass `.kdbx` file holding the user's secrets.
_Avoid_: Vault, store, storage

**Entry**:
A single record inside a Database (credentials, URL, notes, TOTP, history), as KeePass defines it.
_Avoid_: Item, login, credential

**Group**:
A folder-like container of Entries and other Groups inside a Database.
_Avoid_: Folder, collection

**Source**:
Where a Database is read from and written back to: a local file or a WebDAV location.
_Avoid_: Backend, provider, storage

**Local copy**:
The encrypted copy of a Database that the Extension keeps for every Source. The Extension edits it, then writes it to the Source.
_Avoid_: Cache, offline cache, mirror

**Pending changes**:
Changes in the Local copy that have not yet been written to the Source.
_Avoid_: Unsaved changes, dirty state

**Merge**:
Combining two versions of the same Database into one, object by object: the newer version of each Entry or Group wins, the older one is kept in its history, and deletions on either side are honoured.
_Avoid_: Conflict resolution, reconcile

**Sync**:
Bringing a Local copy and its Source back in line: merging in changes found at the Source, then writing the result back.
_Avoid_: Upload, push, refresh

### Access

**Master password**:
The password the user types to open a Database.
_Avoid_: Passphrase, PIN

**Key file**:
A file whose contents form part of the key to a Database, held separately from it.
_Avoid_: Keyfile, key

**Composite key**:
Everything required to open a Database combined: the Master password, Key file and any hardware-key response.
_Avoid_: Master key, credentials

**Unlocked**:
The state in which the Extension holds a Database decrypted and can read Entries without asking for the Composite key again. Its opposite, **Locked**, holds no decrypted data and no key material.
_Avoid_: Open, logged in, session

**Auto-lock**:
Locking an Unlocked Database without the user asking, when a configured condition is met (inactivity, OS screen lock, browser closing, Extension update).
_Avoid_: Timeout, session expiry

### Components

**Extension**:
The browser part of rimlock, shipped for Chrome and Firefox.
_Avoid_: Add-on, plugin, client

**Companion**:
The optional desktop application that extends the Extension with capabilities a browser cannot provide.
_Avoid_: Desktop app, native host, helper

**Core**:
The part of rimlock that owns an Unlocked Database: it opens, edits, merges and saves it, and applies KeePass interop rules. Shared by the Extension and the Companion.
_Avoid_: Engine, backend, SDK

### Filling

**Match**:
An Entry matches a page when one of its URLs names the page's site, following the KeePass conventions rimlock honours, and nothing in the Database hides it from that site. Only matching Entries are offered on a page.
_Avoid_: Suggestion, hit, candidate

**Fill**:
Putting an Entry's username, password or TOTP code into the fields of a web page. A Fill happens only when the user asks for it, never on page load.
_Avoid_: Auto-fill, inject, auto-type

**Inline menu**:
The rimlock menu shown under a login field on a web page, offering the Entries that match the site.
_Avoid_: Dropdown, overlay, autofill popup

**Save prompt**:
The offer to save a new Entry, or update an existing one, after the user submits a login form.
_Avoid_: Save dialog, doorhanger, notification
