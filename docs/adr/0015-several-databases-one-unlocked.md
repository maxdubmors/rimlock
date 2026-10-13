# Several Databases can be added, but only one is Unlocked at a time

The user can add several Databases to the Extension, each with its own Source, Local copy, Pending changes and per-Database settings, but at most one of them is Unlocked. Switching to another Database in the popup locks the current one first. KeePass users commonly keep a personal Database next to a work or shared one, and a single-Database Extension would make them remove a Database, and with it the Local copy, just to look at the other. Allowing several Unlocked at once is the post-MVP feature that stays out of scope: it would multiply the Unlocked state of ADR-0005, mix Matches from different Databases in the Inline menu and ask which Database a Save prompt writes to. With one Unlocked Database, "the Database" in ADR-0005, ADR-0012 and the Core API still means exactly one, and the Inline menu and Save prompt work only with it.

## Considered Options

- **Exactly one Database.** Rejected: switching costs a removal (losing the Local copy and any Pending changes) and a fresh add, and storage keyed per Database is needed anyway so that several Unlocked Databases are not precluded.
- **Several Unlocked at once.** Out of scope for the MVP, not rejected: per-Database storage keeps the way open.

## Consequences

- Everything the Extension stores about a Database is keyed by it: Local copy, Pending changes, `CachedKey`, a remembered Key file, the last Save-prompt Group. Removing a Database deletes all of it, after offering "Download a copy" when Pending changes exist.
- Switching is its own lock reason, `switched`. Quick unlock treats it as a manual Lock (ADR-0012), so it always requires the Composite key.
- While a Database is Locked, its Pending changes reach a WebDAV Source only when the remote has not changed; otherwise the Merge waits for the next unlock, as after an Auto-lock (ADR-0008).
- When every Database is Locked, the Inline menu and the Save prompt open the popup on the last unlocked Database, where the user can switch before unlocking. Matches are never searched across Locked Databases.
- Decision detail: [Decide first run and adding a Database](https://github.com/maxdubmors/rimlock/issues/27).
