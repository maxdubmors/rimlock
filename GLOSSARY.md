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
