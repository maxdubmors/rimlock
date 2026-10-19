# crates/

Local rules for the Rust crates.

## Lints

- Every lint lives in the root `[workspace.lints]`, and every crate inherits it with `[lints] workspace = true` and nothing else; `crates/rimlock-core/tests/workspace_lints.rs` fails otherwise.
- An exception is a local `#[expect(lint, reason = "…")]` on the smallest item. `#[allow]` is itself denied.
- `unsafe_code` is `deny` for the workspace and `#![forbid(unsafe_code)]` in `rimlock-core`, so only the wasm bindings can take an `#[expect]` for what `wasm-bindgen` generates.
- `clippy.toml` lets tests unwrap, expect, panic and index, but clippy counts only `#[test]` functions and `#[cfg(test)]` items as tests. An integration test file therefore starts with `#![cfg(test)]`, so its helpers get the same relaxation.
- Cargo commands take `--locked`; `Cargo.lock` changes only on purpose.

## Interop corpus

`rimlock-core/tests/corpus/` holds `.kdbx` files other KeePass clients saved ([`docs/spec/engineering.md`](../docs/spec/engineering.md) § Tests, which says what they may contain). `tests/corpus.rs`, part of `pnpm test`, opens each one with the key its `manifest.json` entry names and checks what `read_header` and `info()` give against the entry; it fails on a file the manifest does not list. `pnpm test:interop` runs the same tests on files `keepassxc-cli` has just created or saved.

Adding a file:

1. Start from a Database of the generator (`cargo run --locked -p rimlock-core --example fixtures -- DIR`; `databases.json` names its key), open it in the client, edit it, save it.
2. Name it `<client>-<version>-<setting>.kdbx`, its Key file the same with `.keyx`, and put both in `tests/corpus/`.
3. Add its entry to `manifest.json`: `client` and `version`; `made`, how it was made, so the next person can make one like it; `masterPassword` and `keyFile`, `null` when unused; `header`, the format version and KDF parameters the client wrote; `contents`, the Database's name and whether its Recycle Bin is on and exists. Take `header` from a hex dump or the client's database settings, never from what the test reports.
4. `cargo test --locked -p rimlock-core --test corpus`.

A file from `keepassxc-cli`: run `pnpm test:interop DIR` and copy the file, its Key file and its entry from `DIR/manifest.json`; not the `created-*` files, whose KDF is `db-create`'s 1,000,000 rounds. A setting `test:interop` should cover is a line in `settings` of `scripts/test-interop.mjs`; a new KeePassXC version starts in `scripts/interop.Dockerfile`.

## keepass-rs fork

`rimlock-core` depends on [`maxdubmors/keepass-rs`](https://github.com/maxdubmors/keepass-rs), pinned by `rev`. The fork is upstream plus one commit per pending upstream pull request ([`docs/spec/plan.md`](../docs/spec/plan.md) § Fork upkeep). Every commit rimlock pins stays fetchable forever: the AMO source package does not vendor Cargo dependencies, so a reviewer's build fetches the fork by `rev`. A `rimlock-YYYY-MM-DD` tag on the pinned commit is what keeps it reachable after a rebase.

The clone lives at `~/Projects/keepass-rs`: `origin` is the fork, `upstream` is `sseemayer/keepass-rs` (fetch only), local `master` tracks `upstream/master`, and `gh` defaults to the fork.

### Known gaps

What the pinned fork does not give the Core, so the Core works around it. A fork fix that closes a gap deletes its line in the same pull request.

- The outer header is parsed only on the way to decrypting: `DatabaseVersion::parse` is public, the KDF seed and parameters are not. The Core reads the header itself.
- `Database::save` draws the master seed, IV, KDF seed and inner-stream key from `getrandom` and writes KDBX 4.1 only, so its bytes are never reproducible. Test Databases come from the generator's own KDBX writer.
- KDBX 3.1 decrypts the whole payload before it compares the stream start bytes, so a wrong key usually surfaces as `CryptographyError::InvalidPadding`, not `DatabaseKeyError::IncorrectKey`.
- Every error enum is `#[non_exhaustive]` and reachable only through `keepass::error`: a `match` needs a wildcard arm.
- Any bytes are a Key file: what parses as neither XML nor hex is hashed whole, and the v2 `Hash` attribute is not checked (the "v2 Key file hash check" fix of `docs/spec/plan.md`).

### Refs

| Ref | Contents | Who changes it |
|---|---|---|
| `master` | Exact mirror of upstream `master` | `gh repo sync` only |
| `rimlock` (default) | `master` + one commit per pending upstream pull request | the owner: rebase-merge of a fork pull request, or the monthly rebuild |
| `fix/<slug>` | One own fix: one commit on `master`, or on the `carry/<N>` it builds on | agents; force-push allowed |
| `carry/<N>` | Upstream pull request #N by someone else, squashed into one commit | agents; force-push allowed |
| `rebuild/<YYYY-MM>` | Candidate for the monthly rebuild | agents; force-push allowed |
| tag `rimlock-YYYY-MM-DD` | A commit rimlock pins; `.2`, `.3` for a second one that day | agents create; immutable |

Commit on your own `fix/*`, `carry/*` and `rebuild/*` branches only. Every commit on `rimlock` has the subject of its upstream pull request and the trailer `Upstream-PR: sseemayer/keepass-rs#N` (`pending` until the owner opens it), so `git log master..origin/rimlock` lists every pending upstream pull request.

### A fork fix

1. Branch `fix/<slug>` from `upstream/master`, or from `carry/<N>` when the fix builds on it. One commit, trailer `Upstream-PR: pending`. Done when these are green in the clone, the local stand-in for upstream's nix-based CI:
   ```sh
   cargo fmt --check
   cargo test --features save_kdbx4,totp,serialization,_merge
   cargo check --all-features --tests
   cargo clippy --features save_kdbx4,totp,serialization,_merge   # the lib: upstream's tests already have findings
   ```
2. Try it in rimlock through `.cargo/config.toml`, which `.gitignore` keeps out of commits. Delete it before you commit `Cargo.lock`, which then names the git source, never a path.
   ```toml
   [patch."https://github.com/maxdubmors/keepass-rs"]
   keepass = { path = "../keepass-rs" }
   ```
3. Push the branch to `origin` and set `rev` in rimlock to its head, untagged; the rimlock pull request stays a draft. Open the pull request inside the fork: `gh pr create --repo maxdubmors/keepass-rs --base rimlock`. Draft the upstream pull request text in its description; the owner reviews, rebase-merges, and alone opens the upstream pull request.
4. Pin it (below) last, once the rimlock pull request's review is done: a tag is immutable, so a review fix to the fork commit after tagging costs a second tag.

### Carrying an upstream pull request

Branch `carry/<N>` from `upstream/master`, squash pull request #N into one commit with `--author` set to its author and the trailer `Upstream-PR: sseemayer/keepass-rs#N`, then steps 3–4 of a fork fix.

### Pinning

1. Tag the commit as `rimlock-YYYY-MM-DD` and push the tag to `origin`.
2. Set `rev` in rimlock to that commit and name the tag in the comment above it. `pnpm check:fork-pin` and the CI job "keepass-rs pinned at a tag" fail until the tag exists on the fork and points at `rev`; the rimlock pull request stays a draft until they pass.

### The monthly rebuild

1. `gh repo sync maxdubmors/keepass-rs --branch master`.
2. Build `rebuild/<YYYY-MM>`: `upstream/master` plus the commits of `git log master..origin/rimlock`, dropping those whose pull request merged upstream and filling in `pending` trailers whose pull request now exists. Rebase every open `fix/*` and `carry/*` onto the new `master` too, so their upstream pull requests stay mergeable.
3. Pin the head of `rebuild/<YYYY-MM>`. Done when that rimlock pull request has `test:interop` green. After merging it, the owner moves `rimlock` to the same commit.
