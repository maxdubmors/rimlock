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

### Components

**Extension**:
The browser part of rimlock, shipped for Chrome and Firefox.
_Avoid_: Add-on, plugin, client

**Companion**:
The optional desktop application that extends the Extension with capabilities a browser cannot provide.
_Avoid_: Desktop app, native host, helper
