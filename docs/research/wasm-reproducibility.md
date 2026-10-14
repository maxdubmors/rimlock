# Is the WASM build byte-identical on x86_64 and aarch64?

Ticket: [Verify the WASM build is byte-identical on x86_64 and aarch64](https://github.com/maxdubmors/rimlock/issues/38). Probe: [`prototypes/wasm-reproducibility/`](../../prototypes/wasm-reproducibility/).

## Answer

**Not with the pipeline as decided.** Every build on the same architecture was identical (container, bare host from another directory, another `CARGO_HOME`, another `SOURCE_DATE_EPOCH`). The aarch64 build differed in the `.wasm` only: the JS glue and both `.d.ts` were identical everywhere. The cause is a known, open Cargo bug, [rust-lang/cargo#8140](https://github.com/rust-lang/cargo/issues/8140). **A 40-line `RUSTC_WRAPPER` removes it**: with it, the x86_64 and aarch64 builds are byte-identical. That held for all four builds with the wrapper, including a bare Ubuntu 24.04 arm64 build set up the way an AMO reviewer would.

## Builds

Same sources, `Cargo.lock`, Rust 1.99.0 and wasm-bindgen 0.2.129 everywhere. aarch64 ran under qemu-user (binfmt) on an x86_64 host, executing the real aarch64 `rustc`/`wasm-bindgen` binaries.

| Build | Environment | `.wasm` without wrapper | `.wasm` with wrapper |
| --- | --- | --- | --- |
| Container amd64 | `rust:1.99.0-slim-trixie@sha256:2752b3…`, project at `/src`, `CARGO_HOME=/usr/local/cargo` | `c0c9b521…` | `f4eebae7…` |
| Bare x86_64 | Arch Linux, rustup from the distro, project at `…/bare/some/other/place/rimlock`, own `CARGO_HOME`/`RUSTUP_HOME` | `c0c9b521…` | `f4eebae7…` |
| Bare x86_64, `SOURCE_DATE_EPOCH=1700000000` | as above, clean rebuild | `c0c9b521…` | — |
| Container arm64 | same index digest, arm64 variant | **`2123af73…`** | **`f4eebae7…`** |
| Bare Ubuntu 24.04 arm64 | `ubuntu:24.04`, rustup from rustup.rs, project at `/home/reviewer/Downloads/rimlock-src`, `CARGO_HOME=/root/.cargo` (the AMO reviewer path) | not completed (two attempts failed on network errors under qemu: rustup TLS, then the git fetch) | **`f4eebae7…`** |

Glue in every build: `rimlock_core_wasm.js` `a2a86ff4…`, `rimlock_core_wasm.d.ts` `117ba61a…`, `rimlock_core_wasm_bg.wasm.d.ts` `272fb532…`. `smoke.mjs` loads the output in Node 26 and calls every export.

## Cause: host hashes leak into `-C metadata` (cargo#8140)

- Comparing `target/wasm32-unknown-unknown/release/deps/*.rlib` names: of 97 wasm crates, the 51 with no build script or proc macro anywhere below them (`aes`, `sha2`, `cipher`, `hmac`, `cfg_if`, …) got the same hash on both hosts; the 46 that have one (`keepass`, `wasm_bindgen`, `quick_xml`, `chrono`, `serde_wasm_bindgen`, `argon2`, `flate2`, …) did not.
- Cargo 1.99's `compute_metadata` (`src/compiler/build_runner/compilation_files.rs`) hashes the full `rustc -vV` for host units, including the `host:` line, and mixes every dependency's `c_metadata` into a unit's own. Build scripts and proc macros are host units, so the host triple flows into every wasm crate above them. Cargo #14107 removed the `host:` line only for target units themselves.
- The crate hash is part of every mangled symbol (`keepass[c40e14f9851b34a3]` vs `keepass[ecfe13f282b5d551]`) and of every `TypeId`. wasm-bindgen keeps the `name` section by default, so names differ, and the different hashes also change data layout: the two files differed in 148,694 bytes and by 167 bytes in size.
- **Stripping names is not enough.** `wasm-bindgen --remove-name-section --remove-producers-section` made the sizes equal (1,024,134 bytes) but 1,014 bytes still differed (`TypeId` constants and layout). The cargo#8140 thread reports the same for function order.
- Upstream status (2026-10): open since 2020; proposals in cargo #15477 (host-independent hash for host deps) and #17439 (fingerprint build-script output). 2026 comments there report the same `RUSTC_WRAPPER` workaround, one of them for x86_64 vs aarch64 Ubuntu 24.04.

## The workaround

`rustc-wrapper.sh` (set as `RUSTC_WRAPPER` by `build-wasm.sh`): for invocations with `--target wasm32-unknown-unknown` only, it drops cargo's `-C metadata=…` and passes `-C metadata=<sha256 of CARGO_PKG_NAME, CARGO_PKG_VERSION, --crate-name, --crate-type, sorted --cfg feature=…>`. Host units (build scripts, proc macros) are untouched. Within one target build cargo never compiles the same package twice with all of these equal (features are unified per target), so names stay unique; two copies of `base64` (0.22 and 0.23) are separated by the version.

## What else matters and what does not

- **`--remap-path-prefix=$CARGO_HOME=/cargo` is required.** Without it the `.wasm` held 73 strings with the absolute `CARGO_HOME` (panic locations from registry and git dependencies). With it they read `/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/…` and `/cargo/git/checkouts/keepass-rs-deb45182a93bbe71/28c078c/…`; both hashed directory names were the same on every host.
- **The project-path remap is harmless but currently unneeded.** Cargo passes workspace members to rustc by relative path (`crates/rimlock-core-wasm/src/lib.rs`), so two bare builds from different directories without any remap were identical. Keep it for path dependencies outside the workspace and `env!("CARGO_MANIFEST_DIR")`.
- **RUSTFLAGS paths do not leak into hashes.** Cargo skips hashing RUSTFLAGS whenever they contain `--remap-path-prefix` (its own reproducibility hack), which is why builds with different remap source paths matched.
- **`SOURCE_DATE_EPOCH` has no effect on the `.wasm`** (rustc, cargo and wasm-bindgen ignore it). It still matters later for the zip.
- **`RUSTFLAGS` must be complete.** An environment `RUSTFLAGS` replaces every config-file `rustflags`, so `build-wasm.sh` repeats `--cfg getrandom_backend="wasm_js"` from `.cargo/config.toml` and unsets `CARGO_ENCODED_RUSTFLAGS`, `CARGO_BUILD_RUSTFLAGS`, `CARGO_PROFILE_*`, target-dir and wrapper overrides. A reviewer's `~/.cargo/config.toml` can still change the build (e.g. `[profile.release]`); README instructions should say to build without one.
- **wasm-bindgen output is host-independent.** The JS glue and `.d.ts` matched in every build, with and without the wrapper.

## Container definition

[`Dockerfile`](../../prototypes/wasm-reproducibility/Dockerfile): `FROM docker.io/library/rust:1.99.0-slim-trixie@sha256:2752b332db73fdbb7dc576f06c82ed1f312005784ef913d7e04a28f5f55dc581` (multi-arch index digest, so one pin covers amd64 and arm64), `rustup target add wasm32-unknown-unknown`, `cargo install --locked --root /opt/wasm-bindgen wasm-bindgen-cli --version 0.2.129`. No system packages needed.

- **The classic Docker builder silently ignores `--platform`** when an amd64 copy of a multi-arch base is already local: `docker build --platform linux/arm64` produced an `amd64` image twice. Use buildx (`docker buildx build --platform linux/arm64`) and check `docker image inspect --format '{{.Architecture}}'`. The probe built the arm64 image with `docker run --platform linux/arm64` + `docker commit` instead.
- Under qemu on a 12-core host: `wasm-bindgen-cli` took about 45 min to build and the Core 7 min alone (42 min while another qemu build ran, 13 min in the Ubuntu run); natively on x86_64 the image took under 3 min and the Core 1 min. Under emulation rustup's TLS downloads failed once (`tls handshake eof`); `RUSTUP_USE_CURL=1` plus retries got through.

## What the release script must add

1. `RUSTC_WRAPPER=rustc-wrapper.sh` (in the AMO source package, with a comment linking cargo#8140; delete it once Cargo fixes the bug, re-verifying cross-arch).
2. Explicit `RUSTFLAGS` with the `getrandom` cfg and `--remap-path-prefix` for `$CARGO_HOME` (last) and the project root, after unsetting the overrides listed above.
3. `cargo build --locked` and a check that `wasm-bindgen --version` equals the `wasm-bindgen` version in `Cargo.lock`.
4. `SHA256SUMS` of the build output, so CI and reviewers compare hashes, not files.
5. For [Decide CI, releases and store submission](https://github.com/maxdubmors/rimlock/issues/34): a CI job that runs the script natively on `ubuntu-24.04` and `ubuntu-24.04-arm` and fails if `SHA256SUMS` differ; this check is the only guard against the wrapper silently going stale.

## Side findings

- **keepass-rs `merge` panics when the root Group UUIDs differ** (`src/db/merge.rs:180`, `expect("cannot re-add root")`), which traps the WASM instance (`RuntimeError: unreachable`). The Core must reject such a merge before calling it, or the fork must turn it into an error.
- **tsify 0.5.8 deprecates `#[tsify(into_wasm_abi, from_wasm_abi)]`** (memory leak on error paths, madonoharu/tsify#65) in favour of `tsify::Ts<T>` as parameter and return type; the generated `.d.ts` is unchanged. The probe uses `Ts<T>`; `rimlock-core-wasm` should too.
- Probe `.wasm` size at `opt-level = 3`: 1,178,503 bytes (vs 890,290 at `opt-level = "s"` in [Evaluate KDBX core libraries](https://github.com/maxdubmors/rimlock/issues/2)).
