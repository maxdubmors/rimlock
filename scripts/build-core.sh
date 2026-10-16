#!/usr/bin/env bash
# pnpm build:core: compiles rimlock-core-wasm and generates its JS glue and .d.ts into the
# Extension (docs/spec/engineering.md § WASM build). No wasm-pack and no wasm-opt.
# Usage: scripts/build-core.sh [release|dev-wasm] [OUT_DIR]
#   release, the default, is the store bundle's Core; OUT_DIR defaults to the Extension's
#   src/core-bindings/, which the bundle imports.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
profile=${1:-release}
target_dir=${CARGO_TARGET_DIR:-$root/target}
out=${2:-$root/apps/extension/src/core-bindings}

case $profile in
  release | dev-wasm) ;;
  *) echo "unknown profile '$profile': use release or dev-wasm" >&2; exit 2 ;;
esac

# The CLI must be the exact version of the wasm-bindgen crate in Cargo.lock, or the glue
# does not match the .wasm. A copy local to the repository keeps it independent of PATH.
want=$(sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\(.*\)"$/\1/p}' "$root/Cargo.lock")
[[ -n $want ]] || { echo "no wasm-bindgen in Cargo.lock" >&2; exit 1; }
tools=$target_dir/tools
bindgen=$tools/bin/wasm-bindgen
if [[ ! -x $bindgen || $("$bindgen" --version) != "wasm-bindgen $want" ]]; then
  (cd "$root" && cargo install --locked --quiet --root "$tools" --version "=$want" wasm-bindgen-cli)
fi

cd "$root"
cargo build --locked --target wasm32-unknown-unknown --profile "$profile" -p rimlock-core-wasm
"$bindgen" --target web --out-dir "$out" "$target_dir/wasm32-unknown-unknown/$profile/rimlock_core_wasm.wasm"
