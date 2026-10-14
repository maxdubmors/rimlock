# WASM reproducibility probe

Throwaway stand-in for `rimlock-core-wasm`, built to answer
[Verify the WASM build is byte-identical on x86_64 and aarch64](https://github.com/maxdubmors/rimlock/issues/38).
Findings: [`docs/research/wasm-reproducibility.md`](../../docs/research/wasm-reproducibility.md).

- `crates/rimlock-core`: pure Rust over keepass-rs (git dependency at a pinned upstream commit, standing in for the fork) with `save_kdbx4`, `_merge`, `totp`.
- `crates/rimlock-core-wasm`: `#[wasm_bindgen]` functions with `tsify::Ts<T>` types, an indexing panic and an explicit `panic!`.
- `build-wasm.sh`: the WASM half of the future `scripts/build-release.sh` (scrubbed environment, the wrapper, explicit `RUSTFLAGS` with `--remap-path-prefix`, `wasm-bindgen` version check against `Cargo.lock`, `cargo build --locked`, `wasm-bindgen --target web`, `SHA256SUMS`).
- `rustc-wrapper.sh`: `RUSTC_WRAPPER` that replaces cargo's host-dependent `-C metadata` for wasm32 units ([rust-lang/cargo#8140](https://github.com/rust-lang/cargo/issues/8140)); without it the `.wasm` differs between x86_64 and aarch64 hosts.
- `Dockerfile`: the release container (multi-arch index digest of `rust:1.99.0-slim-trixie`, `wasm32-unknown-unknown`, `wasm-bindgen-cli` built with `--locked`).
- `smoke.mjs`: loads the output in Node and calls every export.

## Run

```sh
# in the container (amd64 or, with qemu binfmt registered, arm64)
docker build -t rimlock-wasm-repro .
docker run --rm -v "$PWD":/src rimlock-wasm-repro ./build-wasm.sh /src/out

# bare: rustup picks 1.99.0 from rust-toolchain.toml
cargo install --locked wasm-bindgen-cli --version 0.2.129
./build-wasm.sh

node smoke.mjs out
```

With the classic Docker builder (no buildx), `docker build --platform linux/arm64` silently produces an amd64 image when the base is a multi-arch index; use buildx or check `docker image inspect --format '{{.Architecture}}'`.
