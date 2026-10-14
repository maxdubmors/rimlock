# rimlock privacy policy

rimlock is a browser extension that fills and manages passwords from your own KeePass database (`.kdbx` file). This policy covers the rimlock extension for Chrome and Firefox.

## The short version

rimlock has no servers and no accounts. It sends nothing to its developers or to anyone else. Your database leaves your device only to go to a storage location you configure yourself, and then it is always encrypted.

## What rimlock handles

**Your KeePass database.** rimlock reads the database from the location you choose: a file on your computer or a WebDAV server. It keeps an encrypted copy of that file in the browser's extension storage on your device so it can work offline. rimlock decrypts the database only in memory, after you enter your Master password and, if you use one, your Key file.

**Unlock state.** While the database is unlocked, rimlock keeps key material derived from your Master password in the browser's session storage. That storage lives in memory and is cleared when the database locks, when the browser closes or restarts, and when rimlock is updated. rimlock never stores your Master password.

**Your Key file, only if you ask.** If you turn on "Remember Key file on this device", rimlock stores a processed form of the Key file in the browser's extension storage on your device. It is off by default, and you can forget it at any time in Settings.

**WebDAV credentials.** If you use a WebDAV server, rimlock stores the server address, user name and password in the browser's extension storage on your device, so it can sync while the database is locked. They are sent only to that server.

**Web pages you visit.** To offer and fill logins, rimlock reads the forms on the pages you visit: which fields are login fields, and, when you submit a login form, the user name and password you entered, so it can offer to save them. This happens entirely on your device. Page content is not stored, except a submitted login while rimlock waits for you to save or dismiss it, held in session memory.

**Settings.** Your choices (auto-lock times, clipboard clearing, sites where you said "never save", and similar) are stored in the browser's extension storage on your device. They are not synced through your browser account.

**Clipboard.** When you copy a value, rimlock later clears it from the clipboard if it is still there. To check that, it keeps a one-way hash of the copied value in session memory, never the value itself. It asks for clipboard permissions only for this purpose.

## What rimlock sends, and where

- **To your WebDAV server, if you configure one:** the encrypted database file, plus the requests needed to read, compare and replace it. Nothing else.
- **To anyone else:** nothing. rimlock has no telemetry, no analytics, no crash reporting, no advertising, and no remote configuration. It does not download site icons or detection rules. It makes no network requests other than the ones to your WebDAV server.

rimlock does not sell, share or transfer any data, does not use it for any purpose other than filling and managing your passwords, and does not use it to determine creditworthiness or for lending.

## Where your data lives and how to delete it

Everything rimlock stores is on your device, in the browser's storage for the extension. To delete it:

- remove a database in rimlock's Settings, which deletes its encrypted copy, its remembered Key file and its WebDAV credentials; or
- uninstall rimlock, which deletes all of its storage.

Your original `.kdbx` file and your WebDAV server are not touched by either.

## Permissions

rimlock asks for access to all `http` and `https` sites so it can detect login forms and fill them where you ask. Optional permissions (clipboard, browser privacy settings, downloads in Firefox) are requested only when you use the feature that needs them. The full list and the reason for each is in the [specification](docs/spec/manifest-and-permissions.md).

## Changes to this policy

Changes are made in this file in the public repository, and its history shows every change. A change that affects what data rimlock handles is also noted in the release notes.

## Contact

Open an issue at <https://github.com/maxdubmors/rimlock/issues>.
