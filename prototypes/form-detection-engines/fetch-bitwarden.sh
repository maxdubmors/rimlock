#!/bin/sh
# Sparse-clones bitwarden/clients at the pinned commit into vendor/bitwarden (gitignored).
set -eu
COMMIT=5ea9cb20e3ea65b7d86df45a421f3aff079aa75c
DIR="$(dirname "$0")/vendor/bitwarden"
if [ ! -d "$DIR/.git" ]; then
  git clone -q --filter=blob:none --no-checkout https://github.com/bitwarden/clients.git "$DIR"
fi
cd "$DIR"
git sparse-checkout set --no-cone 'apps/browser/src/autofill/' 'libs/common/src/autofill/' 'libs/common/src/vault/enums/'
git checkout -q "$COMMIT"
