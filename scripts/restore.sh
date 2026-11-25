#!/usr/bin/env bash
###############################################################################
# restore.sh - put a backup.sh tarball back as the Starwake data directory
#
#   restore.sh ARCHIVE [DATA_DIR]          (default /opt/docker/starwake/data)
#
# Stop the container first (sudo docker compose down). The current data directory is
# never deleted: it is moved aside to DATA_DIR.before-restore-<date>. The archive is
# checked before anything moves; files end up owned by uid 1000 (the container user).
###############################################################################
set -euo pipefail
ARCHIVE="${1:-}"
DATA="${2:-/opt/docker/starwake/data}"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "restore: usage: restore.sh ARCHIVE [DATA_DIR]" >&2; exit 2; }
tar -tzf "$ARCHIVE" >/dev/null || { echo "restore: $ARCHIVE is not a readable tar.gz" >&2; exit 1; }
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx starwake; then
    echo "restore: the starwake container is running; stop it first (docker compose down)" >&2
    exit 1
fi
if [[ -e "$DATA" ]]; then
    aside="$DATA.before-restore-$(date +%Y%m%d-%H%M%S)"
    mv -- "$DATA" "$aside"
    echo "restore: kept the old data at $aside"
fi
mkdir -p "$DATA"
tar -xzf "$ARCHIVE" -C "$DATA"
if [[ "$(id -u)" == 0 ]]; then chown -R 1000:1000 "$DATA"; fi
echo "restore: $ARCHIVE → $DATA ($(find "$DATA" -type f | wc -l) files)"
