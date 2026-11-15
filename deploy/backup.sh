#!/bin/bash
# Sauvegarde quotidienne de data.json, avec conservation des 15 dernières copies.
set -euo pipefail
DATA_FILE="${DATA_FILE:-/home/alex/prono/prono-data/data.json}"
DEST="${BACKUP_DIR:-/home/alex/prono/prono-data/sauvegardes}"
mkdir -p "$DEST"
[ -f "$DATA_FILE" ] || exit 0
cp "$DATA_FILE" "$DEST/data-$(date +%Y-%m-%d_%H%M).json"
ls -1t "$DEST"/data-*.json | tail -n +16 | xargs -r rm --
