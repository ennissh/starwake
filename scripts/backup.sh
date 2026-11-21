#!/usr/bin/env bash
###############################################################################
# backup.sh - dated tarball of the Starwake data directory, keeping the newest N
#
#   backup.sh [DATA_DIR] [BACKUP_DIR] [KEEP]
#   defaults:  /opt/docker/starwake/data  /opt/docker/starwake/backups  14
#
# Safe while the game runs: saves are written atomically (temp file + rename).
# Restore: stop the container, extract over an empty data dir, chown 1000:1000, start:
#   cd /opt/docker/starwake && sudo docker compose down
#   sudo mv data data.old && sudo mkdir data
#   sudo tar -xzf backups/starwake-data-<date>.tar.gz -C data && sudo chown -R 1000:1000 data
#   sudo docker compose up -d
###############################################################################
set -euo pipefail
DATA="${1:-/opt/docker/starwake/data}"
DEST="${2:-/opt/docker/starwake/backups}"
KEEP="${3:-14}"
[[ -d "$DATA" ]] || { echo "backup: data dir $DATA not found" >&2; exit 1; }
[[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -ge 1 ]] || { echo "backup: KEEP must be a positive number" >&2; exit 2; }
mkdir -p "$DEST"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$DEST/starwake-data-$stamp.tar.gz"
tar -czf "$out.tmp" -C "$DATA" .
mv "$out.tmp" "$out"
echo "backup: wrote $out ($(du -h "$out" | cut -f1))"
# Keep the newest KEEP backups.
mapfile -t old < <(ls -1t "$DEST"/starwake-data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))")
for f in "${old[@]}"; do rm -f -- "$f" && echo "backup: removed old $f"; done
