#!/usr/bin/env bash
# RUSTC_WRAPPER working around rust-lang/cargo#8140: for wasm32 units, cargo's -C metadata
# mixes in the hashes of build scripts and proc macros, which are built for (and hash) the
# host triple, so symbol hashes and TypeIds differ between x86_64 and aarch64 hosts.
# Replace it with a value derived only from the unit's own identity. Host units are untouched.
set -euo pipefail
rustc=$1; shift

wasm=false
for a in "$@"; do [[ "$a" == wasm32-unknown-unknown || "$a" == --target=wasm32-unknown-unknown ]] && wasm=true; done
$wasm || exec "$rustc" "$@"

# Identity: package, version, crate name and type, enabled features. Within one target
# build, cargo never compiles the same package twice with these all equal.
crate_name=
crate_types=()
features=()
args=()
in=("$@")
for ((i = 0; i < ${#in[@]}; i++)); do
  a=${in[i]}
  next=${in[i+1]:-}
  case "$a" in
    -C) if [[ "$next" == metadata=* ]]; then i=$((i + 1)); continue; fi ;;
    -Cmetadata=*) continue ;;
    --crate-name) crate_name=$next ;;
    --crate-type) crate_types+=("$next") ;;
    --cfg) [[ "$next" == feature=* ]] && features+=("$next") ;;
  esac
  args+=("$a")
done

id=$(printf '%s\n' "${CARGO_PKG_NAME:-}" "${CARGO_PKG_VERSION:-}" "$crate_name" \
  "${crate_types[@]}" $(printf '%s\n' "${features[@]}" | LC_ALL=C sort) | sha256sum | cut -c1-16)
exec "$rustc" "${args[@]}" -C "metadata=$id"
