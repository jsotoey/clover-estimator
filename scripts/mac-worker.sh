#!/bin/bash
# Runs the Clover worker on this Mac (normal home/office internet), talking to the app's database on Railway.
# The app and chat stay on Railway. Run from the project folder:  bash scripts/mac-worker.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="$HOME/.clover-worker.env"
DATA_DIR="$HOME/clover-worker-data"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js 20 or newer is needed. Install the LTS version from https://nodejs.org (one installer), then run this again."
  exit 1
fi

# A settings file from an earlier try with an unusable database address: start over.
if [ -f "$ENV_FILE" ] && grep -q '\${{' "$ENV_FILE"; then rm -f "$ENV_FILE"; fi

if [ ! -f "$ENV_FILE" ]; then
  echo "First-time setup. What you type is saved only on this Mac."
  while :; do
    read -r -p "Paste the database URL (Railway > Postgres > Connect > Public Network): " DBURL
    case "$DBURL" in
      *'${{'*) echo "That's Railway's template, not the real address. Use Postgres > Connect > Public Network and copy the URL there.";;
      postgres://*|postgresql://*) break;;
      *) echo "It should start with postgresql://  Try again.";;
    esac
  done
  read -r -p "Clover email: " CEMAIL
  read -r -s -p "Clover password (hidden): " CPASS; echo
  umask 077
  {
    printf 'DATABASE_URL=%q\n' "$DBURL"
    printf 'CLOVER_EMAIL=%q\n' "$CEMAIL"
    printf 'CLOVER_PASSWORD=%q\n' "$CPASS"
    printf 'MERCHANT_TAX_RATE=0.06625\nDRY_RUN=true\nHEADLESS=false\n'
    printf 'DATA_DIR=%q\n' "$DATA_DIR"
  } > "$ENV_FILE"
  echo "Saved to $ENV_FILE (only your user can read it)."
fi

set -a; source "$ENV_FILE"; set +a
mkdir -p "$DATA_DIR"

echo "Installing (first run takes a few minutes)..."
npx -y pnpm@10.28.0 install --frozen-lockfile
npx -y pnpm@10.28.0 --filter worker exec playwright install chromium
npx -y pnpm@10.28.0 --filter worker migrate

echo
echo "Worker running. A Chrome window will open when Clover needs a sign-in: sign in there (or from the app's Clover page)."
echo "Leave this window open. Your Mac will stay awake while it runs. Press Ctrl+C to stop."
exec caffeinate -i npx -y pnpm@10.28.0 --filter worker start
