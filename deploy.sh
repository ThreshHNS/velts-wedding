#!/bin/bash
# Deploy the wedding bundle (game at /, landing at /main) to the kaya VPS.
# Files are served by the kaya nginx container from /opt/kaya/cdn/velts-wedding
# (the /opt/kaya/cdn dir is already bind-mounted into nginx as /var/www/cdn),
# reachable at https://velts-wedding.ru.
set -euo pipefail

VPS_HOST="${KAYA_VPS_HOST:-139.100.207.158}"
VPS_KEY="${KAYA_VPS_KEY:-$HOME/.ssh/kaya_vps}"
VPS_USER="${KAYA_VPS_USER:-root}"
REMOTE_DIR="/opt/kaya/cdn/velts-wedding"

cd "$(dirname "$0")"

echo ">>> Building (vite): game at /, landing at /main ..."
npm run build
find dist -type d -exec chmod 755 {} +
find dist -type f -exec chmod 644 {} +

echo ">>> Syncing dist/ to $VPS_HOST:$REMOTE_DIR ..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "mkdir -p $REMOTE_DIR && find $REMOTE_DIR -mindepth 1 -delete"
# COPYFILE_DISABLE avoids macOS ._ AppleDouble files inside the tar
COPYFILE_DISABLE=1 tar -C dist -cf - . \
  | ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "tar -C $REMOTE_DIR -xf - && find $REMOTE_DIR -name '._*' -delete && find $REMOTE_DIR -type d -exec chmod 755 {} + && find $REMOTE_DIR -type f -exec chmod 644 {} +"

echo ">>> Done. https://velts-wedding.ru (game)  ·  https://velts-wedding.ru/main/ (invitation)"
