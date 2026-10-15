#!/usr/bin/env bash
# pnpm check:core-bindings: regenerates the Core's bindings and fails if the *.d.ts in the working
# tree differ from them (docs/spec/engineering.md § WASM build). In CI's clean checkout those are
# the committed ones; locally, freshly built *.d.ts pass before they are committed.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
bindings=$root/apps/extension/src/core-bindings
before=$(mktemp -d)
after=$(mktemp -d)
trap 'rm -rf "$before" "$after"' EXIT

# Only the *.d.ts are committed; .gitignore hides the rest of the generated files.
snapshot() { find "$bindings" -maxdepth 1 -name '*.d.ts' -exec cp {} "$1" \; ; }

snapshot "$before"
"$root/scripts/build-core.sh"
snapshot "$after"
if ! diff -r "$before" "$after" >&2; then
  echo "The apps/extension/src/core-bindings/*.d.ts were stale: pnpm build:core has regenerated them; commit them." >&2
  exit 1
fi
