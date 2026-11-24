#!/bin/bash
# Turn real sending on for test contacts only, or back to test mode.
#   bash scripts/test-sending.sh on  you@example.com 5551234567
#   bash scripts/test-sending.sh off
set -euo pipefail
ENV_FILE="$HOME/.clover-worker.env"
[ -f "$ENV_FILE" ] || { echo "Run scripts/mac-worker.sh first."; exit 1; }
grep -v -e '^DRY_RUN=' -e '^SEND_ONLY_TO=' "$ENV_FILE" > "$ENV_FILE.tmp"
if [ "${1:-}" = "on" ]; then
  shift
  [ $# -ge 1 ] || { echo "Give at least one email or phone to allow."; rm -f "$ENV_FILE.tmp"; exit 1; }
  printf 'DRY_RUN=false\nSEND_ONLY_TO=%s\n' "$(IFS=,; echo "$*")" >> "$ENV_FILE.tmp"
  echo "Real sending ON, only to: $*"
else
  printf 'DRY_RUN=true\n' >> "$ENV_FILE.tmp"
  echo "Back to test mode (nothing is sent)."
fi
umask 077; mv "$ENV_FILE.tmp" "$ENV_FILE"
echo "Now restart the worker:  bash scripts/mac-worker.sh"
