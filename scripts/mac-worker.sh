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

if [ ! -f "$ENV_FILE" ]; then
  echo "First-time setup. Nothing you type here is shown or sent anywhere except this Mac's settings file."
  read -r -p "Paste DATABASE_PUBLIC_URL (Railway > Postgres > Variables): " DBURL
  read -r -p "Clover email: " CEMAIL
  read -r -s -p "Clover password (hidden): " CPASS; echo
  umask 077
  cat > "$ENV_FILE" <<EOV
DATABASE_URL=$DBURL
CLOVER_EMAIL=$CEMAIL
CLOVER_PASSWORD=$CPASS
MERCHANT_TAX_RATE=0.06625
DRY_RUN=true
HEADLESS=false
DATA_DIR=$DATA_DIR
EOV
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
