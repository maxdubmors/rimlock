#!/usr/bin/env bash
# Part of pnpm check: every end-to-end test file that launches the bundle runs the canary check
# after each test (docs/spec/engineering.md § Checks). harness.test.ts is the one exception: it
# plants the markers the check must find, and calls findLeaks itself.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root/apps/extension/tests/e2e"
missing=()
while IFS= read -r file; do
  [[ $file == harness.test.ts ]] && continue
  grep -Eq '^[[:space:]]*useCanaryCheck\(' "$file" || missing+=("$file")
done < <(git grep --untracked -l 'launchWithExtension(' -- '*.test.ts')
if ((${#missing[@]})); then
  printf 'apps/extension/tests/e2e/%s\n' "${missing[@]}" >&2
  echo "These files launch the bundle without useCanaryCheck(() => session) (tests/e2e/canaries.ts)." >&2
  exit 1
fi
