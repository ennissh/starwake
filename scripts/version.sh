#!/usr/bin/env bash
# Print this build's version: X.Y.Z-N (R7). X.Y.Z comes from VERSION; N is the number of commits
# since VERSION last changed, counting that commit as 1, so it needs no stored counter.
# A dirty tree appends "-dirty" (build.sh refuses to push those).
#   scripts/version.sh            → 0.1.0-12
#   scripts/version.sh --release  → 0.1.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
base="$(tr -d '[:space:]' < VERSION)"
[[ "$base" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION must be X.Y.Z, got '$base'" >&2; exit 1; }
if [[ "${1:-}" == "--release" ]]; then echo "$base"; exit 0; fi
if ! git rev-parse --git-dir >/dev/null 2>&1; then echo "${base}-0"; exit 0; fi
since="$(git log -1 --format=%H -- VERSION 2>/dev/null || true)"
if [[ -z "$since" ]]; then
    n="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
else
    n="$(( $(git rev-list --count "${since}..HEAD") + 1 ))"
fi
dirty=""
[[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]] && dirty="-dirty"
echo "${base}-${n}${dirty}"
