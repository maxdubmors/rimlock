#!/usr/bin/env bash
# Stand-in for the WASM half of scripts/build-release.sh. Runs the same way
# inside the release container and bare on a reviewer's machine.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
cargo_home=$(cd "${CARGO_HOME:-$HOME/.cargo}" && pwd -P)
out=${1:-$root/out}

# Anything in the caller's environment that would change rustc's input is dropped:
# RUSTFLAGS replaces every config-file rustflags, so the full set is spelled out here.
unset CARGO_ENCODED_RUSTFLAGS CARGO_BUILD_RUSTFLAGS CARGO_BUILD_TARGET_DIR CARGO_TARGET_DIR \
      CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS RUSTC_WRAPPER CARGO_BUILD_RUSTC_WRAPPER
while IFS= read -r v; do unset "$v"; done < <(env | sed -n 's/^\(CARGO_PROFILE_[A-Z0-9_]*\)=.*/\1/p')

# Later --remap-path-prefix wins, so $CARGO_HOME goes last in case it lives under the project.
export RUSTFLAGS="--cfg getrandom_backend=\"wasm_js\" --remap-path-prefix=$root=/rimlock --remap-path-prefix=$cargo_home=/cargo"
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-0}
# Host-independent -C metadata for wasm32 units (rust-lang/cargo#8140); see the wrapper.
export RUSTC_WRAPPER="$root/rustc-wrapper.sh"

want=$(sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\(.*\)"$/\1/p}' "$root/Cargo.lock")
have=$(wasm-bindgen --version | cut -d' ' -f2)
[[ "$have" == "$want" ]] || { echo "wasm-bindgen CLI $have, Cargo.lock pins $want" >&2; exit 1; }

cd "$root"
cargo build --locked --release --target wasm32-unknown-unknown -p rimlock-core-wasm
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" target/wasm32-unknown-unknown/release/rimlock_core_wasm.wasm
(cd "$out" && sha256sum -- * | tee SHA256SUMS)
