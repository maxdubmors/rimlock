#!/usr/bin/env bash
# pnpm check:core-bindings: regenerates the Core's bindings and fails if the committed *.d.ts
# differ from them (docs/spec/engineering.md § WASM build), for CI to call on every pull request.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
bindings=apps/extension/src/core-bindings

"$root/scripts/build-core.sh"
cd "$root"
# A new .d.ts is untracked, a changed or deleted one is a diff; .gitignore hides everything else.
untracked=$(git ls-files --others --exclude-standard -- "$bindings")
if ! git diff --quiet -- "$bindings" || [[ -n $untracked ]]; then
  git status --short -- "$bindings" >&2
  echo "The committed $bindings/*.d.ts are stale: run pnpm build:core and commit them." >&2
  exit 1
fi
