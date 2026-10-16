#!/usr/bin/env bash
# The keepass-rs pin (crates/AGENTS.md § Pinning): the `rev` rimlock-core depends on is the commit
# that the tag named in its comment points at, a rimlock-YYYY-MM-DD tag on the fork. That tag is
# what keeps the commit fetchable for the AMO source build. Fails while the fork fix is unpinned,
# so a pull request carrying one stays a draft until then.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
manifest="$root/crates/rimlock-core/Cargo.toml"
fork=https://github.com/maxdubmors/keepass-rs

fail() {
  echo "check-fork-pin: $1" >&2
  exit 1
}

rev=$(sed -nE 's|^keepass = \{ git = "'"$fork"'", rev = "([0-9a-f]{40})" \}$|\1|p' "$manifest")
[[ -n $rev ]] || fail "no 'keepass = { git = \"$fork\", rev = \"<40 hex>\" }' line in $manifest"

tag=$(sed -nE 's|^# The rimlock fork .*, pinned at tag (rimlock-[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?)\.$|\1|p' "$manifest")
[[ -n $tag ]] || fail "the comment above the keepass line names no 'pinned at tag rimlock-YYYY-MM-DD[.N].'"

tagged=$(git ls-remote --tags "$fork" "refs/tags/$tag" | cut -f1)
[[ -n $tagged ]] || fail "$tag does not exist on $fork: tag the pinned commit and push the tag"
[[ $tagged == "$rev" ]] || fail "$tag points at $tagged, but rev is $rev"
echo "keepass-rs pinned at $tag ($rev)"
