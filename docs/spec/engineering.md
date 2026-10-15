# Engineering: layout, build, checks, tests, CI and releases

Principles: [ADR-0016](../adr/0016-one-repository-isolated-extension-build.md) (one repository, isolated reproducible build), [ADR-0017](../adr/0017-browser-tests-drive-the-store-bundle-through-puppeteer.md) (browser tests drive the store bundle), [ADR-0018](../adr/0018-releases-built-by-ci-uploaded-by-hand.md) (releases built by CI, uploaded by hand), [ADR-0003](../adr/0003-core-over-keepass-rs-fork.md) (Core over a keepass-rs fork).

## Stack

pnpm + WXT (exact pin) + Svelte 5 + TypeScript 6.x; Rust + `wasm-bindgen` + `tsify` for the Core; MV3 in both browsers. The Core depends on a rimlock fork of keepass-rs pinned to a commit. Every fork fix also goes upstream as its own pull request, and rimlock returns to crates.io once all of them have merged.

## Repository layout

```
Cargo.toml, Cargo.lock, rust-toolchain.toml   # root Cargo workspace: only the crates the Extension builds
crates/
  rimlock-core/          # pure Rust, no wasm-bindgen; the Companion will link it natively
  rimlock-core-wasm/     # wasm-bindgen + tsify bindings, thin
apps/
  extension/             # the WXT app, the only pnpm workspace package
  (later) companion-linux/   # GTK4 + libadwaita, its own Cargo workspace and Cargo.lock
  (later) companion-macos/   # Xcode project, also the Safari container
package.json, pnpm-workspace.yaml, pnpm-lock.yaml   # root scripts
scripts/                 # build-release.sh, rustc-wrapper.sh
docs/, GLOSSARY.md, AGENTS.md, PRIVACY.md, BUILDING.md, RELEASING.md, CHANGELOG.md, NOTICE, LICENSE
```

- Prototypes never land on `main`; they stay on their `task/*`, `research/*` and `prototype/*` branches.
- `AGENTS.md` at the root (repository map, commands, the rules below) plus `crates/AGENTS.md` and `apps/extension/AGENTS.md` (local rules), all written in M0.

## TypeScript modules (`apps/extension/src/`)

```
entrypoints/    # thin WXT entrypoints: background, popup, options, offscreen, content, inline-menu, welcome
background/     # CoreClient, message router, Auto-lock, Sync, Database registry, pending saves
sources/        # Source adapters: chrome-local, firefox-import, webdav
matching/       # URL matching (Bitwarden-derived), PSL
autofill/       # FormDetector, shadow-root walk, Fill, submit detection (page side)
generator/      # pure function
ui/             # one Svelte app for popup, tab and options
protocol/       # message types and the Secret codec, shared by every context
settings/       # schema, defaults, migrations
shared/         # Secret, Result, i18n
core-bindings/  # wasm-bindgen output (only *.d.ts committed)
vendor/         # vendored third-party code, each with UPSTREAM.md
```

- Folders, not packages. Boundaries are ESLint rules on **resolved** paths (`import-x/no-restricted-paths`, so re-exports cannot bypass them; `no-restricted-imports` is the fallback):
  - content-side code (`autofill/`, the `content` and `inline-menu` entrypoints) never imports `background/`, `sources/`, `core-bindings/` or `settings/`. The rule is an allowlist: content-side code imports only content-side code and `protocol/`, `shared/`, `generator/`, `matching/`, `vendor/`, so neither `ui/` nor another entrypoint opens a path around it;
  - those shared modules import only each other: the plugin checks one import at a time, so this is what stops a re-export ([`verification.md`](verification.md) V4);
  - only `background/` itself and the `background` entrypoint import `background/`; every other context, `ui/` included, reaches the background through `protocol/` messages, so no chain of imports leads into it.
- Content code, and the modules it may import, never touch `storage`: `no-restricted-properties` (any `.storage`, so `browser.storage`, destructuring and aliases of `browser`), `no-restricted-globals` (`storage`), `no-restricted-imports` (`wxt/utils/storage`, `@wxt-dev/storage`).
- Every boundary and storage rule has a permanent lint fixture test (`apps/extension/tests/lint/`).
- WXT auto-imports are off (`imports: false`); every import is explicit.
- Vendored code lives in `vendor/<name>/` with `UPSTREAM.md` (repository, commit, licence, local modifications). It is not reformatted, but it is type-checked and boundary-checked. The Proton classifier is an npm dependency, not vendored.
- Messages between contexts are typed in `protocol/` with an exhaustive discriminated union. `Secret` crosses only through the protocol codec.
- i18n: `@wxt-dev/i18n`, strings in `apps/extension/locales/en.yml`, typed keys, generated `_locales/`. No string literal in UI code.

## Rust crates

- `rimlock-core`: `unsafe_code = "forbid"` (`#![forbid(unsafe_code)]`; the workspace denies it, so the bindings can `#[expect]` what `wasm-bindgen` generates). Secrets in `zeroize` types that implement neither `Debug` nor `Display` with their content. Clock and RNG are injected.
- `rimlock-core-wasm`: wasm-bindgen + `tsify` (use `tsify::Ts<T>`, not the deprecated `into_wasm_abi`/`from_wasm_abi`). As strict as the generated code allows.
- The Core API is [`core-api.md`](core-api.md); the committed `.d.ts` must match it.

## WASM build

- `pnpm build:core` (`scripts/build-core.sh`): `cargo build --target wasm32-unknown-unknown -p rimlock-core-wasm`, then `wasm-bindgen --target web` into `apps/extension/src/core-bindings/`. The CLI version equals the pinned `wasm-bindgen = "=X"` crate version: the script reads it from `Cargo.lock` and installs that CLI into `target/tools/` on first use. No wasm-pack and no wasm-opt in the MVP.
- Release profile: `opt-level = 3`, `lto = "fat"`, `codegen-units = 1`. Development profile `dev-wasm`: optimised (Argon2 in debug is unusably slow) with debug assertions on. `pnpm build:core` builds `release`, the Core of the store bundle; `pnpm dev` builds `dev-wasm`.
- Vite picks up the `.wasm` from wasm-bindgen's `new URL(…, import.meta.url)` with no plugin. The background is an ES module (`type: "module"` in both browsers): WXT builds a classic background as a Vite library, and Vite inlines every asset of a library as base64, which would put the whole Core into `background.js`. The manifest CSP needs `'wasm-unsafe-eval'`.
- No Rust watcher: after Rust edits, run `pnpm build:core`; WXT reloads the new glue.
- Only the generated `*.d.ts` are committed. `pnpm check:core-bindings` regenerates them and fails on a diff; CI runs it.

## Pinning and reproducibility

- `rust-toolchain.toml` (exact version, `wasm32-unknown-unknown`), `.node-version` + `engines`, `packageManager: pnpm@…`, exact npm versions (`save-exact`), `Cargo.lock` committed, `cargo build --locked`.
- TypeScript 6.x everywhere (typescript-eslint and `svelte-check` do not support TS 7 yet). If WXT pulls TS 7, alias `typescript` to the TS 6 package ([`verification.md`](verification.md) V4).
- **Release build:** `scripts/build-release.sh` inside a digest-pinned container (pinned Rust image, `wasm-bindgen-cli`, Node, pnpm). The same script runs bare for AMO reviewers, following `BUILDING.md`. It must:
  1. set `RUSTC_WRAPPER=scripts/rustc-wrapper.sh`, which gives wasm32 units a host-independent `-C metadata` ([rust-lang/cargo#8140](https://github.com/rust-lang/cargo/issues/8140)); without it the aarch64 `.wasm` differs;
  2. set `RUSTFLAGS` explicitly (the `getrandom` cfg, `--remap-path-prefix` for `$CARGO_HOME`, which is required, and for the project path) after unsetting `CARGO_ENCODED_RUSTFLAGS`, `CARGO_BUILD_RUSTFLAGS`, `CARGO_PROFILE_*`, target-dir and wrapper overrides;
  3. write `SHA256SUMS` of the outputs.
- Build the arm64 container image with buildx (the classic builder can silently produce amd64).
- Facts and the probe: [Verify the WASM build is byte-identical on x86_64 and aarch64](https://github.com/maxdubmors/rimlock/issues/38).

## Checks: `pnpm check`

One command: formatting check, lint, type checks and clippy.

- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noImplicitOverride`; `svelte-check`. ESLint flat config: typescript-eslint `strictTypeChecked` (including `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `restrict-template-expressions`) + `eslint-plugin-svelte` + the boundary and storage rules above + the local rule `rimlock/no-async-event-handler`, which does for Svelte event attributes what `no-misused-promises` does for JSX ([`verification.md`](verification.md) V4). Prettier + `prettier-plugin-svelte` formats. Not oxlint, not Biome, not a hybrid ([Compare TypeScript linters: ESLint, Biome and oxlint](https://github.com/maxdubmors/rimlock/issues/37)).
- **Rust:** `rustfmt`; root `[workspace.lints]`: `clippy::all` + `clippy::pedantic` as `deny` with no global exceptions; from `restriction`: `unwrap_used`, `expect_used`, `panic`, `indexing_slicing`, `todo`, `unimplemented` (a panic kills the WASM instance), `dbg_macro`, `print_stdout`, `print_stderr`, `allow_attributes`, `allow_attributes_without_reason` (exceptions only as `#[expect(lint, reason = "…")]`). `clippy.toml` allows unwrap/expect/panic/indexing in tests. Run as `cargo clippy --all-targets -- -D warnings`.

## Tests

**Runners**

- Rust: `cargo test`. Unit tests inline; integration tests in `crates/rimlock-core/tests/`; the interop corpus in `crates/rimlock-core/tests/corpus/`.
- TypeScript: Vitest + `WxtVitest` + `fakeBrowser` (`@webext-core/fake-browser`). Unit tests next to the code (`foo.test.ts`); the rest in `apps/extension/tests/{e2e,autofill,contract,webdav,manifest}/` (`manifest/` builds both browsers with WXT and checks the built `manifest.json`).
- Svelte: Vitest + `@testing-library/svelte` on jsdom, only for components with logic (Draft, Entry editor, generator). No UI snapshot tests.
- Browsers: Puppeteer (`puppeteer-core`) driving pinned Chrome for Testing and Firefox, headless, with Vitest as the runner (`vitest.e2e.config.ts`). The pins are the builds `puppeteer-core` itself is tested against (`tests/e2e/browsers.ts`), downloaded by `@puppeteer/browsers` into Puppeteer's cache. They load the **release bundle**: the harness builds it with `wxt build` in production mode before the run, with no test hooks and no test build flavour. Time moves through fake clocks installed in page contexts and the shortest values the Settings schema allows; what cannot be reached that way is tested one level down with injected clocks.

**Fakes and contract suites**

- `FakeCore` (in-memory, typed against the committed `core-bindings/*.d.ts`) and `FakeSource` (in-memory, with fault injection: failed condition, network down, file changed between `stat` and `write`) live next to their interfaces, so TypeScript-only work needs no Rust toolchain.
- A fake exists only with a **contract suite** that runs the same tests against the fake and the real thing: the Core suite against the WASM build (`dev-wasm`); the WebDAV adapter suite against the Docker matrix; the Chrome local-file adapter suite against OPFS handles in real Chrome.

**Core depth**

- Golden round trips over the interop corpus.
- `proptest` for Merge (idempotence, rollback safety, nothing lost) and for "read → write unchanged → equal".
- `cargo-fuzz` on the KDBX parser and `apply` inputs (goal: no panic), on nightly Rust outside the pinned toolchain; never blocks a pull request.
- Challenge-response tests use the software HMAC-SHA1 reference provider.
- No coverage threshold.

**Corpora and data**

- **Interop corpus:** small synthetic `.kdbx` files with no real secrets and a low KDF, plus a `manifest` (client, version, contents, password). rimlock → KeePassXC → rimlock is automated with `keepassxc-cli` in a container. KeePass 2.x, Strongbox and KeePassDX are done by hand before releases and after interop changes, and the files they save are committed.
- **Autofill corpus:** the synthetic fixtures with labels and the shadow-DOM fixtures from [Verify Proton classification across shadow roots](https://github.com/maxdubmors/rimlock/issues/24) move to `apps/extension/tests/autofill/` (the source is `prototypes/` on the `task/*` branches). Third-party page snapshots never enter the repository; `live-corpus.json` (URL + expected labels) and a script drive a manual live run on every Proton bump, and each miss becomes a synthetic fixture.
- **WebDAV matrix:** `docker-compose` with Nextcloud, oCIS, Apache `mod_dav`, nginx `dav` and rclone `serve webdav`.
- **TLS for test servers:** rimlock refuses `http://` everywhere, so the test servers speak HTTPS. A script creates a throwaway test CA and server certificates on every run (openssl; nothing is committed), and one Caddy container in the same `docker-compose` terminates TLS in front of all servers under names such as `nextcloud.webdav.test`. The Node contract suite (`test:webdav`) runs on the host, trusts the CA through `NODE_EXTRA_CA_CERTS`, and resolves `*.webdav.test` to the proxy with a custom `lookup` on the global undici dispatcher, set in the suite's setup file, so it needs neither `/etc/hosts` edits nor a run inside the Docker network (V5). `NODE_EXTRA_CA_CERTS`, unlike the dispatcher, does **not** go in that setup file: Node reads it only when the process starts, so assigning `process.env` there has no effect. The script that creates the CA exports it before it launches Vitest. The browser E2E scenarios launch Chrome and Firefox through Puppeteer with `acceptInsecureCerts: true`; whether that also covers fetches from the Extension's background is [`verification.md`](verification.md) V24, whose Plan B imports the CA into the test browser profile instead. There is no test build that allows `http://` (ADR-0017). The "certificate not trusted" path stays on the manual checklist.
- **Test Databases:** a deterministic Rust generator (`cargo run -p rimlock-core --example fixtures`) builds the scenario Database and the **reference Database** (~1000 Entries with History, ~1 MB, KeePassXC-default KDF) before each E2E run. Nothing generated is committed.

**Tiers**

1. `pnpm test`: no browsers, no Docker. Rust unit + golden corpus, TS unit on fakes, contract suites against `FakeCore`. About one minute. **`pnpm check && pnpm test` is green before every pull request.**
2. `pnpm test:e2e`: headless Chrome and Firefox. Autofill fixtures, the end-to-end scenarios, the Core contract suite against real WASM, the wake-up benchmark.
3. `pnpm test:webdav`, `pnpm test:interop`: Docker matrices.
4. The manual pre-release checklist: Strongbox, KeePassDX, KeePass 2.x, Synology, a self-signed certificate, the live autofill corpus, the File System Access permission lifecycle and `FileSystemObserver`, the 200 ms gate on the owner's machine.

**End-to-end scenarios** (walking paths; field-level behaviour is tested lower down):

1. Install → welcome tab → add a Database → unlock (WebDAV in Chrome, import in Firefox; the picker cannot be automated).
2. Background killed → rebuild without the Master password (Chrome: stop the service worker over CDP; Firefox: `extensions.background.idle.timeout`).
3. Popup search → Copy → clipboard cleared.
4. Inline menu → Fill on a fixture page served on localhost under several host names.
5. Submit → Save prompt → **Unlock and save** → popup → saved.
6. Edit an Entry → the Draft survives closing the popup.
7. Auto-lock by deadline.
8. WebDAV Sync with a conflict against one Docker server.

A scenario that cannot be expressed in Puppeteer moves to the manual checklist; it does not bring in a second tool.

**Performance:** the E2E benchmark kills the background and measures the rebuild with `performance.mark` on the reference Database in both browsers. CI reports the number and fails only above 400 ms. The real gate (≤ 200 ms) is a manual measurement on the owner's machine before each release.

**Secret leaks:** the test Databases contain unique canary markers (Master password, Entry passwords, TOTP seed). After every E2E scenario a shared `afterEach` dumps `storage.local`, IndexedDB (the encrypted Local copy is fine), `storage.session` (only the `CachedKey` may hold key material), messages to content scripts and console logs, and fails on any marker. A unit test checks that `Secret` gives a placeholder under `JSON.stringify`, `String()` and `console.log`.

## Rules for agents

The rules every agent follows live in the root [`AGENTS.md`](../../AGENTS.md) § Start here and § Rules, and nowhere else: that file is loaded into every agent's context, so it is their single source.

## CI

- GitHub Actions on GitHub-hosted runners (`ubuntu-24.04`, `ubuntu-24.04-arm`). Every action pinned by commit SHA; default `permissions: contents: read`, widened per job; no `pull_request_target`; no secrets in any pull-request job.
- **Every pull request (required):** `pnpm check`, `pnpm test`, the regenerated `core-bindings/*.d.ts` equal to the committed ones, `pnpm test:e2e` in Chrome and Firefox.
- **Path-filtered (required when they run):** `test:webdav` (`sources/`, the WebDAV suite or compose file); `test:interop` (`crates/`); the cross-architecture job (`crates/`, `Cargo.lock`, `rust-toolchain.toml`, `scripts/`, the Dockerfile, `pnpm-lock.yaml`), which runs `build-release.sh` natively on x86_64 and arm64 and fails if the `SHA256SUMS` differ.
- **Nightly on `main`:** all of the above unfiltered, plus `cargo-fuzz`. A fuzz failure opens an issue and never blocks a merge.
- CI publishes the built `manifest.json` and the module list of the `content` bundle as artifacts, so a pull request that changes them is visible.
- `main`: pull requests only, required checks green, squash merge, linear history, no force-push.

## Versions, changelog and releases

- SemVer `X.Y.Z`, one version for both browsers, one tag `extension-vX.Y.Z`. The single source is `apps/extension/package.json`. `0.x` until the first stable public release; the first listed version is `0.1.0`. The fourth component `X.Y.Z.N` stays free.
- If one store rejects a version, the fix ships as the next patch for both.
- `CHANGELOG.md` in Keep a Changelog form, written by hand. The `Unreleased` text becomes the GitHub Release notes and the stores' "what's new".
- **Release flow** (written into `RELEASING.md` and `.github/ISSUE_TEMPLATE/release.md` in M5):
  1. Open a release issue: the tier-4 checklist plus the publishing steps.
  2. Run the checklist on the candidate bundle (unpacked in Chrome; unsigned in Firefox Developer Edition or as a temporary add-on).
  3. The owner pushes an SSH-signed tag `extension-vX.Y.Z`; a ruleset lets only the owner create, move or delete `extension-v*` tags.
  4. The release workflow verifies the tag signature, builds in the pinned container on x86_64 and arm64 and compares `SHA256SUMS`, builds the AMO source package and rebuilds from it, attests the artifacts (`actions/attest`) and creates a **draft** GitHub Release.
  5. The owner runs `gh attestation verify --signer-workflow …`, checks the hashes, signs a CRX from the Chrome zip with the offline RSA key, uploads it to the Chrome Web Store dashboard, and uploads the Firefox zip with the source package and reviewer notes to AMO.
  6. Each store publishes when it approves. The GitHub Release is published at the first approval.
- No store API key, OAuth token, service account or CRX key ever enters GitHub secrets.
- **Stores and accounts:** CWS verified CRX uploads turned on before the first upload of `0.1.0` (the RSA-2048 key is kept offline with two backups); a CWS group publisher account; a dedicated AMO account; 2FA everywhere with offline recovery codes; a dedicated project mailbox. `RELEASING.md` records where things are, never the secrets.
- **AMO source package:** `git archive` of the tag with a whitelist: root manifests, `crates/`, `apps/extension/`, `scripts/`, the Dockerfile, `LICENSE`, `BUILDING.md`. No `docs/`, prototypes, Companions or test corpora.
- **`BUILDING.md`** is the single build instruction: a bare build on Ubuntu 24.04 arm64 (AMO's reviewer default), the expected `SHA256SUMS`, and a warning against a personal `~/.cargo/config.toml`.
- **AMO dry run** (M0): an unlisted upload numbered `0.0.N` from the real release build, which also exercises `BUILDING.md`. There is no CWS dry run.
- No beta channel.

## Dependency updates

- Renovate GitHub App, weekly; dev dependencies grouped in one pull request, runtime dependencies one per pull request; **no automerge**.
- `minimumReleaseAge: 7 days` for npm and Cargo (waived only for security updates), plus `minimumReleaseAge: 10080` in `pnpm-workspace.yaml`.
- Special rules:
  - **Proton classifier:** the bot only opens the pull request; the manual live-corpus run is required.
  - **keepass-rs fork:** excluded from the bot; rebased by hand in its own pull request; merged only with `test:interop` green.
  - **Rust toolchain + `wasm-bindgen` crate + `wasm-bindgen-cli` + the container base image:** one grouped pull request; the cross-architecture job is required; the changelog notes that the next release gets a fresh AMO source review.
  - **WXT:** `test:e2e` in both browsers plus a review of the built `manifest.json` diff.
  - **TypeScript 7:** ignored until typescript-eslint and `svelte-check` support it.
  - **Content-script dependencies:** a new runtime module in the `content` bundle needs the owner's decision.

Decision detail: [Decide the repository layout and build](https://github.com/maxdubmors/rimlock/issues/32), [Decide the testing strategy](https://github.com/maxdubmors/rimlock/issues/33), [Decide CI, releases and store submission](https://github.com/maxdubmors/rimlock/issues/34), [Lock the stack and the TS/Rust split](https://github.com/maxdubmors/rimlock/issues/11).
