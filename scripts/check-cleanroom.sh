#!/usr/bin/env bash
# Clean-room check (PLAN.md §0.1): fail if any banned term appears in content/, apps/, packages/ or e2e/.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
terms="$(grep -v '^\s*#' scripts/cleanroom-terms.txt | sed '/^\s*$/d' | paste -sd'|')"
dirs=()
for d in content apps packages e2e; do [[ -d $d ]] && dirs+=("$d"); done
if hits="$(grep -rniwE --exclude-dir=node_modules --exclude-dir=dist --binary-files=without-match "($terms)" "${dirs[@]}")"; then
    echo "clean-room check FAILED: banned terms found:" >&2
    echo "$hits" >&2
    exit 1
fi
echo "clean-room check: ok"
