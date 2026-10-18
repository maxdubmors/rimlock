#!/usr/bin/env bash
# Part of pnpm check: every row of a Markdown table has as many cells as its header
# (docs/spec/engineering.md § Checks). Markdown is formatted by hand, so a stray `|` would move
# every later cell of its row into the wrong column. As in GFM, every unescaped `|` splits cells,
# inside a code span too.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
git ls-files -z --cached --others --exclude-standard -- '*.md' | xargs -0 awk '
  function cells(line) {
    gsub(/\\\|/, "", line)
    sub(/^[[:space:]]*\|/, "", line)
    sub(/\|[[:space:]]*$/, "", line)
    return gsub(/\|/, "", line) + 1
  }
  FNR == 1 { fenced = 0; header = 0 }
  /^[[:space:]]*(```|~~~)/ { fenced = !fenced; header = 0; next }
  fenced { next }
  !/^[[:space:]]*\|/ { header = 0; next }
  header == 0 { header = cells($0); next }
  cells($0) != header {
    printf "%s:%d: %d cells, the header has %d\n", FILENAME, FNR, cells($0), header > "/dev/stderr"
    failed = 1
  }
  END { exit failed }
' || {
  echo "A Markdown table row has the wrong number of cells: check for a stray or unescaped |." >&2
  exit 1
}
