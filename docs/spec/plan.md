# Implementation plan

Six milestones from an empty repository to `0.1.0` in the Chrome Web Store and on AMO. Each milestone ends in something that runs, and each has exit criteria that must be shown, not claimed.

```
M0 Foundation and checks ──────────┐
 │                                 ▼
 │   Core track (rimlock-core + keepass-rs fork), from day one of M0:
 │     Merge parity suite → Merge decision (end of M0) → Merge, save, 4.1, …
 │                                 │
 └─ M1 Read-only vault ◄───────────┘  TS work starts on FakeCore after M0;
     │                                M1 exits only when the Core track is ready
     └─ M2 Autofill ............ first usable build (not published)
         └─ M3 Writing
             └─ M4 Save prompt
                 └─ M5 Release 0.1.0
```

**The Core track is the critical path to M1's exit.** Six of its seven fixes, the full Merge among them, are needed by M1, so it starts on day one of M0 as its own stream of issues, not after M0. The TypeScript side of M1 does not wait for it: it is built against `FakeCore` and its contract suite. What waits is M1's exit (the Merge properties, the real-WASM E2E scenarios, a real pull over WebDAV).

**Why this order.** M0 tests the assumptions everything rests on (the 200 ms wake-up rebuild, WASM in a Firefox event page, the Chrome file handle, the AMO reproducible build) before any feature depends on them. M1 and M2 give a build that reads the owner's real Database and fills logins but **never writes to a Source**, so it can be used daily with no risk to the file. Writing (M3) comes once that build has proved useful, because writes carry the interop risk. The Save prompt (M4) needs writing. M5 finishes what only matters for a public release.

**The first usable build** is the end of M2. It is not published to either store: the owner runs it unpacked in Chrome and as an unsigned build in Firefox Developer Edition. Nothing reaches a store before `0.1.0`, apart from M0's unlisted AMO dry run.

## How a milestone runs

1. The owner opens a GitHub Milestone named after it and slices its scope below into issues: vertical slices where possible, each labelled `ready-for-agent` (or `ready-for-human` for account and store work). Slicing happens when the milestone starts, not earlier, so it can use what the previous milestone learned.
2. An agent takes one issue, works on a branch, and opens a pull request with `pnpm check && pnpm test` green and the spec updated if the work departed from it ([`README.md`](README.md)). The owner reviews and merges; agents never merge.
3. A question the spec does not answer becomes an issue labelled `needs-triage`, not a decision inside a pull request.
4. The milestone closes with a comment on its tracking issue that shows evidence for every exit criterion (test runs, measurements, links). The milestone's heading below then gets a link to that comment.

## M0: Foundation and checks

**Goal:** a repository where agents can work safely, plus answers to every unverified fact.

**Scope**

- **Repository skeleton** per [`engineering.md`](engineering.md): root Cargo workspace (`rimlock-core`, `rimlock-core-wasm`), `apps/extension` (WXT, Svelte 5, all entrypoints as stubs), root scripts (`build`, `build:core`, `dev`, `check`, `test`, `test:e2e`, `test:webdav`, `test:interop`), every pin, `LICENSE` (GPL-3.0, [ADR-0001](../adr/0001-gpl-3-license.md)), `NOTICE`, `CHANGELOG.md`, Renovate config.
- **The full manifest** of [`manifest-and-permissions.md`](manifest-and-permissions.md) from the start, with the fixed Firefox `gecko.id` and the Chrome development `key`; browser floors computed from the API list.
- **`pnpm check`**: the ESLint config with boundary and storage rules, Prettier, `svelte-check`, rustfmt, clippy with the workspace lints.
- **Core, minimal:** `readHeader`, `unlock`, `open` with the `CachedKey`. Fork fix: open from a cached transformed key.
- **The Core track starts** (§ The Core track): the Merge parity suite, then the Merge decision.
- **Test skeleton** ([`engineering.md`](engineering.md) § Tests), in this order:
  1. Vitest + `WxtVitest` + `fakeBrowser`; `pnpm test` also runs `cargo test`.
  2. The `CoreClient` and `SourceAdapter` interfaces with `FakeCore`, `FakeSource` and their (small) contract suites against both sides.
  3. The test-Database generator, including the reference Database.
  4. The Puppeteer harness: build the release bundle, load it into Chrome for Testing and Firefox, and run one smoke test: WASM loads in the background, unlock, background killed, rebuild timed, canary check.
  5. The synthetic and shadow-DOM autofill fixtures with their runner, ported from the prototype branches. The runner targets the `FormDetector` interface; the prototype's walk and grouping, ported as they are, are its first implementation and M2's starting point.
  6. The interop corpus directory with its `manifest` and the first KeePassXC files.
  7. `docker-compose` for the WebDAV matrix, with the throwaway test CA script and the Caddy TLS proxy in front of every server ([`engineering.md`](engineering.md) § Tests).
- **Release build:** `scripts/build-release.sh`, `scripts/rustc-wrapper.sh`, the digest-pinned Dockerfile, `BUILDING.md`.
- **CI:** the pull-request jobs and the path-filtered jobs, including the cross-architecture `SHA256SUMS` job ([`engineering.md`](engineering.md) § CI). The release workflow waits for M5.
- **AMO dry run:** an unlisted `0.0.N` built by the release script.
- **`AGENTS.md`**: the root file gains the repository map, the commands and the rules for agents; `crates/AGENTS.md` and `apps/extension/AGENTS.md` hold the local rules.
- **Run every check in [`verification.md`](verification.md)** and record the results. Probes are throwaway branches or, where possible, permanent tests.

**Exit criteria**

- `pnpm check && pnpm test && pnpm test:e2e` green in Chrome and Firefox, locally and in CI.
- The smoke test passes: WASM in the background, unlock, background killed, rebuild without the Master password, canary check clean.
- The wake-up rebuild of the reference Database measured on the owner's machine at **≤ 200 ms** in both browsers (V1).
- `SHA256SUMS` identical on x86_64 and arm64.
- AMO accepted the unlisted `0.0.N`, built from the source package by following `BUILDING.md`.
- No empty **Result** cell in `verification.md`. Every failed check has either its Plan B applied in the spec or a linked `needs-triage` issue.
- The Merge decision is made and recorded (§ The Core track).

## M1: Read-only vault

**Goal:** add a real Database, unlock it, find and copy anything in it, and see changes made by other clients. Nothing is ever written to a Source.

**Scope**

- **Core:** `merge` (complete KeePassXC semantics, including `RemoteKeyChanged`), the read API (`EntrySummary` with `MatchingInfo`, search, `reveal`, `totp`), verify-on-commit, KDBX 4.1 writes for Merge commits, AES-KDF in WebCrypto behind the Core's `Kdf`. Fork fixes: complete Merge (attachments, custom icons, Meta, no panic on differing root Groups), save reusing the KDF seed, 4.1 output with the 3.1 → 4.1 round trip, the v2 Key file hash check, opening Groups with unknown children and non-contiguous `<String>`.
- **Background:** the message router and `protocol/` with the `Secret` codec, `CoreClient`, the Database registry, Lock with reasons, Auto-lock T1–T3 and the other triggers, the wake-up rebuild ([`databases-and-unlock.md`](databases-and-unlock.md)).
- **Sources:** the WebDAV adapter (all of `stat`/`read`/`write`, so its contract suite covers writes) and the Chrome local-file adapter (picker, grant at unlock, the offscreen document holding the handle, `FileSystemObserver`); the Firefox import and **Re-import…**; Sync **without the write step** ([`sources.md`](sources.md)). In M1 the Local copy only ever changes by Merge.
- **UI:** the welcome tab, adding a Database (both Sources, the three error kinds, duplicates), unlock in the popup and in a tab, Key file remembering, the Database list and switching, Home search, Browse, the Recycle Bin (view only), the Entry view with the live TOTP code, the status line.
- **Copy** with clipboard clearing and its optional permissions ([`generator-and-copy.md`](generator-and-copy.md)).
- **Commands:** `_execute_action`, `lock`.
- **Settings:** the storage layer (schema, defaults, migrations), `options.html`, the Security section and the Databases section (Forget Key file, WebDAV credentials, Remove with **Download a copy**).

**Exit criteria**

- E2E scenarios 1 (install → add → unlock), 2 (rebuild after the background is killed), 3 (search → Copy → clipboard cleared) and 7 (Auto-lock) green in both browsers.
- **The Core track is ready for M1:** every fix the table below marks "M1" has landed in the fork or in `rimlock-core`, and the Merge parity suite is green.
- The Merge `proptest` properties and the golden corpus round trips green; the WebDAV adapter contract suite green against the whole Docker matrix.
- Sync pulls a change made in KeePassXC into the Local copy over WebDAV, with no write to the server (checked in the server log).
- Manual: a Chrome local-file Database survives a browser restart (one gesture restores access); `FileSystemObserver` sees a save from KeePassXC.

## M2: Autofill (the first usable build)

**Goal:** fill logins on real sites from the Unlocked Database.

**Scope**

- **Content side:** the content script, `FormDetector` over Proton with the shadow-root walk and grouping, Fill with the fill-time checks, multi-step memory, TOTP fill, idempotent injection and orphan clean-up ([`autofill.md`](autofill.md)).
- **Matching:** `matching/` with the PSL, KeePassXC-parity rules and every opt-out signal; the Match-count badge.
- **The Inline menu:** the closed shadow host, extension-origin iframe and top layer; clickjacking checks; keyboard; "Click to unlock" with `action.openPopup()` and the tab fallback; **Search in rimlock**; cross-site frames.
- **Popup:** Matches on Home, **Fill** on rows, Enter to Fill, the confirmation for a non-matching Entry (without "Also use this Entry on *site*", which needs writing and comes in M3).
- **The `fill` command.**
- **Site access:** the `activeTab` path, the "rimlock can't see this site" banner, re-injection on install, update and `permissions.onAdded`, `storage.local.setAccessLevel`.
- **Settings:** the Autofill section with **Show the Inline menu** and the site-access status.

**Exit criteria**

- E2E scenario 4 (Inline menu → Fill) green in both browsers.
- The synthetic and shadow-DOM autofill fixtures green in both browsers.
- A manual live-corpus run with every miss reduced to a synthetic fixture or recorded as a known gap.
- **Dogfood:** the owner uses this build daily for one week on their own Database, in both browsers, and writes down what got in the way. Anything that blocks daily use is fixed before M3 starts.

## M3: Writing

**Goal:** full editing, and every change reaches the Source without loss.

**Scope**

- **Core:** `apply` with every change kind, the interop write rules of [`interop.md`](interop.md) (URLs, TOTP, tags, `BrowserHideEntry`, History trimming on the edited Entry only, the lazily created Recycle Bin, `DeletedObjects`), `history`, `reveal` with `historyIndex`, `passwordEquals`, `EntryChanged`, `ReservedKey`/`DuplicateKey`.
- **Sync writes:** WebDAV temp + `MOVE` with the conditional checks, retries and backoff, status and errors; Chrome file writes through the offscreen document with the `lastModified`/`size` check and the no-grant fallback; Firefox **Export…** with the `downloads` permission; the `RemoteKeyChanged` flow with Pending changes ([`sources.md`](sources.md)).
- **UI** ([`popup.md`](popup.md)): the Entry editor (all fields, custom fields, TOTP editing with the live code, tags, standard icons, Expiry, "Don't offer in browser"), Drafts with every Lock and Sync case, Delete with Undo, the Recycle Bin actions, Groups, **Move to…**, multi-select, History with restore and delete, "Also use this Entry on *site*".
- **The Password generator**: the pure function, the popup tab, the editor panel ([`generator-and-copy.md`](generator-and-copy.md)).
- **Remove** a Database with **Sync first** / **Download a copy** / **Remove anyway**.

**Exit criteria**

- E2E scenarios 6 (the Draft survives closing the popup) and 8 (WebDAV Sync with a conflict) green in both browsers.
- `pnpm test:interop` green; `pnpm test:webdav` green on the whole matrix, writes included.
- Manual round trip rimlock → Strongbox, KeePassDX and KeePass 2.x → rimlock done, with the saved files committed to the interop corpus and their tests green.
- The owner's own Database has been edited from rimlock alongside KeePassXC over WebDAV for a week with no lost change.

## M4: Save prompt

**Goal:** new and changed logins are saved from the page.

**Scope**

- Page-side submit detection; pending saves in `storage.session`; the Save prompt card with its isolation; the Update/new decision table; the Group picker remembering the last Group; **Never for this site** and the Never-save sites list; **Unlock and save** through the popup or the tab fallback ([`autofill.md`](autofill.md)).
- The generator in the Inline menu on new-password fields, the pending generated password and the "Unsaved generated password for *site*" banner.
- **Settings:** **Offer to save logins**, **Offer the generator in the Inline menu**, the Never-save sites list.

**Exit criteria**

- E2E scenario 5 (submit → Save prompt → **Unlock and save** → popup → saved) green in both browsers.
- Unit tests cover every row of the Update/new decision table and the pending-save lifecycle (shown, completed, dismissed, dropped on Lock and restart).
- A manual run of sign-up, login and password-change flows on the live corpus sites, with the results recorded.

## M5: Release 0.1.0

**Goal:** `0.1.0` approved in the Chrome Web Store and on AMO.

**Scope**

- The last first-run screen: site access and **Turn off the browser's password saving** (`privacy`).
- Settings complete: the Shortcuts section from `commands.getAll()`, About, **Reset all settings**.
- An i18n pass: no literal UI string left outside `locales/en.yml`.
- **Help pages** in `docs/help/` in the repository, linked from the Extension by URL. Topics the spec already promises: the remaining race with another app's save (local file and WebDAV), self-signed certificates, YubiKey Databases not supported yet, the silent 4.1 upgrade, clipboard managers and history, what a Firefox import is, what rimlock cannot protect against ([`security.md`](security.md)), shortcuts that another extension took.
- Store material: check [`docs/store/listing.md`](../store/listing.md) and [`PRIVACY.md`](../../PRIVACY.md) against the built `manifest.json`; screenshots.
- Release machinery: the release workflow (signed-tag check, both architectures, source-package rebuild, attestations, draft Release), the `extension-v*` tag ruleset, `RELEASING.md`, `.github/ISSUE_TEMPLATE/release.md` with the tier-4 checklist, the "Report this file" issue template if M1 did not add it.
- Accounts (`ready-for-human`): the CWS group publisher, the AMO account, 2FA and recovery codes, the CRX signing key with two offline backups, the project mailbox.

**Exit criteria**

- The full tier-4 manual checklist passed on the candidate bundle, including the ≤ 200 ms gate on the owner's machine.
- The release workflow produced an attested draft Release from a signed tag, with identical `SHA256SUMS` on both architectures.
- CWS verified CRX uploads are on; `0.1.0` is approved in the Chrome Web Store and on AMO.

## The Core track

Starts on day one of M0, as its own stream of issues. Every fork fix is its own upstream pull request; the fork carries what has not merged yet.

**Merge comes first, tests before code.** Merge is the hardest part and the one Database integrity depends on most, and it is being worked on upstream right now (open keepass-rs pull requests on Meta and `DeletedObjects`, attachments, same-second edits, and a three-way merge). So:

1. Write the **Merge parity suite** in `rimlock-core` first: golden cases taken from KeePassXC's own merge tests, plus the `proptest` properties (idempotence, rollback safety, nothing lost). It is rimlock's definition of correct Merge, whoever implements it.
2. **Merge decision, at the end of M0:** run the suite against upstream's merge with the open upstream merge pull requests applied in the fork.
   - It passes, or the gaps are small fixes: keep Merge in keepass-rs and send the fixes upstream.
   - It does not: rimlock writes its own Merge in `rimlock-core` over keepass-rs's model, and the fork shrinks to parsing and saving (the Core runs the KDF since M0). This settles the choice that [ADR-0003](../adr/0003-core-over-keepass-rs-fork.md)'s Consequences left open ("complete merge … or an own merge in the Core"); the ADR itself does not change.
   - Record the outcome and its evidence on the M0 tracking issue.

| Fix | Needed by |
|---|---|
| Open from a cached transformed key | M0 |
| Save without re-running the KDF (reuse the KDF seed, fresh master seed) | M1 |
| Complete Merge: attachments, custom icons, Meta; an error instead of a panic on differing root Groups | M1 |
| Never write above 4.1; verified 3.1 → 4.1 round trip | M1 |
| v2 Key file hash check | M1 |
| Open Groups with unknown children; non-contiguous `<String>` | M1 |
| A challenge-response hook: not built, but the API leaves room | — |

**Fork upkeep.**

- One commit per fix, matching one upstream pull request, so the fork is always "upstream + a list of pending pull requests".
- Rebase on upstream once a month and before every release, in its own pull request, merged only with `test:interop` green (Renovate leaves the fork alone, [`engineering.md`](engineering.md)).
- keepass-rs types never cross the seam (ADR-0003), so even a long-lived fork, or a switch to another library, stays inside `rimlock-core`.
- A fix that waits upstream for longer than a release cycle is fine; the fork carries it. Revisit the strategy only if a monthly rebase starts to cost more than a day.

## After 0.1.0

Everything in the map's "Out of scope" list stays out until it is planned as its own effort. The first candidates the spec already leaves room for: the Companion (YubiKey, Firefox live files, self-signed WebDAV), Quick unlock, an S3-compatible Source, a beta channel, settings sync.
