# crates/

Local rules for the Rust crates.

## Lints

- Every lint lives in the root `[workspace.lints]`, and every crate inherits it with `[lints] workspace = true` and nothing else; `crates/rimlock-core/tests/workspace_lints.rs` fails otherwise.
- An exception is a local `#[expect(lint, reason = "…")]` on the smallest item. `#[allow]` is itself denied.
- `clippy.toml` lets tests unwrap, expect, panic and index, but clippy counts only `#[test]` functions and `#[cfg(test)]` items as tests. An integration test file therefore starts with `#![cfg(test)]`, so its helpers get the same relaxation.
- Cargo commands take `--locked`; `Cargo.lock` changes only on purpose.

## keepass-rs fork

`rimlock-core` depends on [`maxdubmors/keepass-rs`](https://github.com/maxdubmors/keepass-rs), pinned by `rev`. The fork is upstream plus one commit per pending upstream pull request ([`docs/spec/plan.md`](../docs/spec/plan.md) § Fork upkeep). Every commit rimlock pins stays fetchable forever: the AMO source package does not vendor Cargo dependencies, so a reviewer's build fetches the fork by `rev`. A `rimlock-YYYY-MM-DD` tag on the pinned commit is what keeps it reachable after a rebase.

The clone lives at `~/Projects/keepass-rs`: `origin` is the fork, `upstream` is `sseemayer/keepass-rs` (fetch only), local `master` tracks `upstream/master`, and `gh` defaults to the fork.

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

1. Branch `fix/<slug>` from `upstream/master`, or from `carry/<N>` when the fix builds on it. One commit, trailer `Upstream-PR: pending`. Done when `cargo test` is green in the clone.
2. Try it in rimlock through an uncommitted `.cargo/config.toml`, and delete that file before committing: `Cargo.lock` names the git source, never a path.
   ```toml
   [patch."https://github.com/maxdubmors/keepass-rs"]
   keepass = { path = "../keepass-rs" }
   ```
3. Push the branch to `origin` and open the pull request inside the fork: `gh pr create --repo maxdubmors/keepass-rs --base rimlock`. Draft the upstream pull request text in its description; the owner reviews, rebase-merges, and alone opens the upstream pull request.
4. Pin it (below).

### Carrying an upstream pull request

Branch `carry/<N>` from `upstream/master`, squash pull request #N into one commit with `--author` set to its author and the trailer `Upstream-PR: sseemayer/keepass-rs#N`, then steps 3–4 of a fork fix.

### Pinning

1. Tag the commit as `rimlock-YYYY-MM-DD` and push the tag to `origin`.
2. Set `rev` in rimlock to that commit. The rimlock pull request stays a draft until `rev` names a tagged commit.

### The monthly rebuild

1. `gh repo sync maxdubmors/keepass-rs --branch master`.
2. Build `rebuild/<YYYY-MM>`: `upstream/master` plus the commits of `git log master..origin/rimlock`, dropping those whose pull request merged upstream and filling in `pending` trailers whose pull request now exists. Rebase every open `fix/*` and `carry/*` onto the new `master` too, so their upstream pull requests stay mergeable.
3. Pin the head of `rebuild/<YYYY-MM>`. Done when that rimlock pull request has `test:interop` green. After merging it, the owner moves `rimlock` to the same commit.
