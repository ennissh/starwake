#!/usr/bin/env bash
# Copy deploy/compose.yaml and scripts/backup.sh into install.sh's embedded blocks, so the installer
# is one self-contained file (R23).
#   scripts/sync-installer.sh           rewrite install.sh
#   scripts/sync-installer.sh --check   fail if install.sh is out of date (test.sh runs this)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
fill() {  # fill MARKER FILE < install.sh : replace the heredoc body between the marker lines
    awk -v m="$1" -v f="$2" '
        $0 ~ "<<.\\x27?" m "\\x27?$" { print; while ((getline line < f) > 0) print line; skip = 1; next }
        skip && $0 == m { skip = 0 }
        !skip { print }
    '
}
out="$(fill STARWAKE_EMBED_COMPOSE deploy/compose.yaml < install.sh | fill STARWAKE_EMBED_BACKUP scripts/backup.sh)"
if [[ "${1:-}" == "--check" ]]; then
    if [[ "$out" != "$(cat install.sh)" ]]; then
        echo "install.sh is out of date with deploy/compose.yaml or scripts/backup.sh: run scripts/sync-installer.sh" >&2
        exit 1
    fi
    echo "installer check: ok (embedded files match)"
else
    printf '%s\n' "$out" > install.sh
    echo "install.sh updated"
fi
