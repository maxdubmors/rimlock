#!/usr/bin/env bash
# Part of pnpm check: a code comment cites an ADR or a spec section, never a tracker issue, whose
# number goes stale once it closes (docs/spec/engineering.md § Checks). Docs link issues freely.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
# A comment opener (//, /*, a JSDoc *, <!--) followed on the same line by #123 or …/issues/123.
pattern='(//|/\*|^[[:space:]]*\*|<!--).*(#[0-9]+|/issues/[0-9]+)'
if git grep --untracked -nE "$pattern" -- '*.rs' '*.ts' '*.js' '*.svelte' \
  ':!apps/extension/src/core-bindings/' >&2; then
  echo "A code comment names a tracker issue: cite the ADR or spec section that carries the rule." >&2
  exit 1
fi
