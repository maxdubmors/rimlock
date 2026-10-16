# rimlock MVP spec

This is the entry point for anyone, human or agent, who implements the rimlock MVP. Start here, then read only the files your task touches.

## What is being built

The MVP of the rimlock **Extension** for Chrome and Firefox. It is a password manager that works directly on the user's own KeePass `.kdbx` file and keeps that file the single source of truth. Other KeePass clients (KeePassXC, Strongbox, KeePassDX, …) keep using the same file, at the same time.

MVP features:

- add a Database from a local file or WebDAV; unlock with Master password and Key file; Auto-lock;
- search, browse, and Match Entries to the current site;
- the Inline menu in login fields, Fill on click or shortcut, TOTP fill;
- the Save prompt after a login form is submitted (save new or update);
- the Password generator;
- full editing: Entries, Groups, Recycle Bin, History, TOTP;
- Copy with clipboard clearing.

Not in the MVP: the Companion (only its seam), Safari, mobile, attachments, passkeys, Quick unlock, creating a Database, importing from other password managers. None of these may be precluded. The full list is the "Out of scope" section of [Pick the way to the rimlock MVP spec](https://github.com/maxdubmors/rimlock/issues/1).

## How the docs fit together

| Kind | Where | Answers |
|---|---|---|
| Glossary | [`GLOSSARY.md`](../../GLOSSARY.md) | What the words mean. Use these terms in code, tests, issues and UI copy. |
| ADRs | [`docs/adr/`](../adr/) | Why a hard-to-reverse decision was made, and what was rejected. |
| Spec | `docs/spec/` (this folder) | What to build and how it behaves. Normative. |
| Plan | [`plan.md`](plan.md) | In which order, and what each milestone must prove. |
| Tickets | [the map](https://github.com/maxdubmors/rimlock/issues/1) and its closed children | The discussion and research behind each decision. History, not instructions. |

When the spec and a ticket disagree, the spec wins: it carries later amendments that the ticket text does not. When the spec and an ADR disagree, that is a bug in the spec: raise it.

A rule has one home: the spec file whose area covers it in the table under Reading order. Another file that needs the rule links there with `§` instead of restating it, so changing the rule is a one-file edit.

## Reading order

1. [`GLOSSARY.md`](../../GLOSSARY.md), the whole file (it is short).
2. [`security.md`](security.md): the invariants every feature must keep.
3. [`plan.md`](plan.md): find the milestone your task belongs to.
4. The spec files for your area:

| File | Covers |
|---|---|
| [`core-api.md`](core-api.md) | The Core's WASM API and the Source adapter contract. |
| [`databases-and-unlock.md`](databases-and-unlock.md) | First run, adding and removing Databases, unlock, the Unlocked state, wake-up rebuild, Lock and Auto-lock. |
| [`sources.md`](sources.md) | Local copy, Pending changes, Chrome local file, Firefox import/export, WebDAV, Sync, Merge. |
| [`interop.md`](interop.md) | How the Core reads and writes KeePass data so other clients keep working. |
| [`popup.md`](popup.md) | The adaptive UI (popup and tab): navigation, Entry view and editor, Drafts, Groups, Recycle Bin, History, TOTP. |
| [`autofill.md`](autofill.md) | Form detection, Match, the Inline menu, Fill, the Save prompt. |
| [`generator-and-copy.md`](generator-and-copy.md) | Password generator, Copy, clipboard clearing, keyboard shortcuts. |
| [`settings.md`](settings.md) | Settings: storage, global vs per-Database, the Settings screen. |
| [`manifest-and-permissions.md`](manifest-and-permissions.md) | Manifest keys, required and optional permissions, re-injection, store disclosures. |
| [`engineering.md`](engineering.md) | Repository layout, build, checks, tests, CI, releases, dependency updates. |
| [`verification.md`](verification.md) | Runtime facts nobody has verified yet, each with its Plan B. Filled in milestone M0. |

5. The ADRs the spec file links to, when you need to know why.

Also at the root: [`PRIVACY.md`](../../PRIVACY.md) (the privacy policy both stores link to) and [`docs/store/listing.md`](../store/listing.md) (store listing copy and reviewer notes).

## Architecture in one page

```
 web page                          extension origin
┌─────────────────────────┐      ┌───────────────────────────────────────────┐
│ content script          │      │ background (Chrome: service worker,       │
│  FormDetector (Proton)  │◄────►│            Firefox: event page)           │
│  shadow-root walk, Fill │ msgs │  message router  ──  Auto-lock deadlines  │
│  submit detection       │      │  CoreClient ──► Core (Rust → WASM)        │
│ ┌─────────────────────┐ │      │  Sync ──► SourceAdapter (webdav,          │
│ │ closed shadow host  │ │      │                         chrome-local)     │
│ │  └ iframe (ext.     │◄┼─port─┤  Database registry, pending saves         │
│ │    origin): Inline  │ │      └───────▲───────────────▲───────────────────┘
│ │    menu / Save card │ │              │ msgs          │ msgs
│ └─────────────────────┘ │      ┌───────┴──────┐  ┌─────┴────────────────────┐
└─────────────────────────┘      │ popup / tab  │  │ offscreen doc (Chrome):  │
                                 │ (one Svelte  │  │ file handle, Observer,   │
                                 │  app)        │  │ clipboard clearing       │
                                 └──────────────┘  └──────────────────────────┘
 storage.session: CachedKey, deadlines, Draft, pending saves (trusted memory)
 storage.local:   Settings, Database registry, WebDAV credentials, remembered Key file
 IndexedDB:       Local copy per Database (encrypted .kdbx bytes), Chrome file handles
```

- **The background alone owns the Core** and the Unlocked Database. It dies after ~30 s idle and rebuilds the Database on every wake-up from the Local copy and the `CachedKey` in `storage.session`, without running the KDF ([ADR-0005](../adr/0005-unlocked-state-rebuilt-on-every-wake-up.md)).
- **The Core owns the Database; TypeScript owns the browser.** The Core does KDBX, keys, edits, Merge, search, TOTP and the interop rules. TypeScript does Source I/O, UI, messaging, autofill, URL matching and the generator ([ADR-0003](../adr/0003-core-over-keepass-rs-fork.md)).
- **Every edit commits at once.** `apply(changes[])` returns the verified encrypted file. It replaces the Local copy, and Sync writes it to the Source later ([ADR-0014](../adr/0014-core-mutations-return-the-verified-file.md)).
- **Secrets cross the seam only per use**, wrapped in `Secret`. Content scripts and the Inline menu get display data only ([`core-api.md`](core-api.md), [`security.md`](security.md)).

## Rules for changing the spec

- A pull request that departs from the spec updates the spec in the same pull request.
- A pull request that contradicts an ADR says so explicitly and links the ADR. It never overrides one silently. Changing an ADR is the owner's decision.
- A question the spec does not answer becomes a GitHub issue labelled `needs-triage`. Do not decide it inside an implementation pull request.
- New domain terms go to `GLOSSARY.md`; implementation vocabulary does not.
