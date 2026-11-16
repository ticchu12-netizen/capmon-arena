#!/usr/bin/env bash
# Copies the working tree to durable storage and writes a tarball. Usage: tools/checkpoint.sh "note"
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
D=/mnt/user-data/outputs/capmon-arena
mkdir -p "$D"
# source of truth only: no node_modules, no reference model copy
tar -C "$W" --exclude=node_modules --exclude='*.tmp' --exclude='test/out/*.f32' --exclude='test/out/*.f64' --exclude='test/out/*.u8' --exclude='test/out/preview' --exclude='test/out/shots' -czf /tmp/capmon-arena-checkpoint.tgz .
cp /tmp/capmon-arena-checkpoint.tgz /mnt/user-data/outputs/capmon-arena-checkpoint.tgz
rm -rf "$D.new" && mkdir -p "$D.new" && tar -C "$D.new" -xzf /tmp/capmon-arena-checkpoint.tgz
rm -rf "$D" && mv "$D.new" "$D"
echo "$(date -u '+%Y-%m-%d %H:%M UTC') | ${1:-checkpoint}" >> "$D/CHECKPOINTS.txt"
cp "$D/CHECKPOINTS.txt" "$W/CHECKPOINTS.txt" 2>/dev/null || true
echo "checkpoint saved: $(du -sh "$D" | cut -f1), tarball $(du -h /mnt/user-data/outputs/capmon-arena-checkpoint.tgz | cut -f1)"
