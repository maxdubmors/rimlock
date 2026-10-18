## Start here

The MVP spec starts at `docs/spec/README.md`: what is being built, the reading order, and the implementation plan (`docs/spec/plan.md`). Read it before any implementation work.

- A pull request that departs from the spec updates the spec in the same pull request.
- A pull request that contradicts an ADR in `docs/adr/` says so explicitly and links it; it never overrides an ADR silently.
- A question the spec does not answer becomes an issue labelled `needs-triage`, not a decision inside a pull request.

## Repository map

```
Cargo.toml, rust-toolchain.toml   root Cargo workspace (crates/AGENTS.md)
crates/rimlock-core/              the Core: pure Rust, no wasm-bindgen
crates/rimlock-core-wasm/         thin wasm-bindgen bindings of the Core
apps/extension/                   the WXT app, the only pnpm package (apps/extension/AGENTS.md)
docs/spec/, docs/adr/, GLOSSARY.md   the spec, decisions and vocabulary
CODING_STANDARDS.md               what review checks by judgement
```

The full layout and the module folders of `apps/extension/src/` are `docs/spec/engineering.md` § Repository layout and § TypeScript modules.

## Commands

Run from the repository root. A ticket that adds a root script adds its line here.

| Command | Does |
|---|---|
| `pnpm install` | Installs with the pinned pnpm; refuses packages younger than 7 days (`minimumReleaseAge`). |
| `pnpm check` | Prettier (the app and the root `package.json`, `pnpm-workspace.yaml`; Markdown is formatted by hand), `tsc`, `svelte-check`, ESLint, `cargo fmt --check`, clippy on the host and on `wasm32`, no tracker issue named in a code comment, Markdown table cell counts, the canary check in every end-to-end file that launches the bundle. Fails on any finding. |
| `pnpm test` | `build:core`, Vitest, then `cargo test`. No browsers, no Docker. |
| `pnpm test:e2e` | `build:core`, then Puppeteer runs the store bundle in pinned headless Chrome and Firefox (~700 MB downloaded on the first run), and the `CoreClient` contract suite runs against a `dev-wasm` Core built for the run. |
| `pnpm build:core` | Core → WASM glue and `.d.ts` in `apps/extension/src/core-bindings/`. After every Rust edit; commit the changed `*.d.ts`. |
| `pnpm check:core-bindings` | Fails if the `*.d.ts` in the working tree are stale; fresh uncommitted ones pass. |
| `pnpm check:fork-pin` | Fails unless the keepass-rs `rev` is the commit its comment's `rimlock-*` tag points at on the fork. |
| `pnpm build` | `build:core`, then the Extension for both browsers into `apps/extension/.output/`. |
| `pnpm build:report` | `build:core`, then per browser the built `manifest.json` and the `content` bundle's module list into `apps/extension/.output/bundle-report/`, the files CI publishes. |
| `pnpm dev` | WXT dev server for Chrome on a `dev-wasm` Core (Firefox: `pnpm --filter @rimlock/extension dev:firefox`). |

One test file: `pnpm --filter @rimlock/extension exec vitest run <path>` (end-to-end: add `--config vitest.e2e.config.ts`; both need `pnpm build:core` once in a fresh checkout) or `cargo test -p rimlock-core --test <name>`.

## Rules

- Work on a `task/<issue>-<slug>` branch; `main` takes pull requests only.
- `pnpm check && pnpm test` green before every pull request.
- A pull request must pass every job of `.github/workflows/pull-request.yml`.
- Every behaviour change comes with a test; a bug fix starts with a failing test.
- Test through a module's public interface (the folders of `engineering.md` § TypeScript modules), not its internals.
- Core tests use no real time or randomness.
- A new fake, a reusable stand-in for an interface such as `FakeCore`, arrives only with its contract suite; a stub inside one test file needs none.
- A failing or flaky test is never skipped without an issue.
- No panics in Rust, no printing near secrets, no `{@html}` on Database content.
- Every user-visible change adds a line to `CHANGELOG.md` under `Unreleased`.
- Agents never merge; the owner does.

## keepass-rs fork

Work on the keepass-rs fork (a fork fix, carrying an upstream pull request, the monthly rebuild, bumping its `rev`) follows `crates/AGENTS.md` § keepass-rs fork.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (maxdubmors/rimlock) via the `gh` CLI. Before the first `gh` call, read `docs/agents/issue-tracker.md`: how to read a ticket, and why a milestone's tracking issue is skipped.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
