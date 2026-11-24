#!/bin/bash
# Keeps the Clover worker running on this Mac and updates it by itself.
# Start once from the project folder:  bash scripts/mac-autorun.sh
# It copies itself to ~/.clover-runner.sh and loops: download latest -> run worker -> (worker exits when a
# newer version is published, or if it crashes) -> repeat. Close the Terminal window or Ctrl+C to stop.
set -uo pipefail
REPO="jsotoey/clover-estimator"; BRANCH="claude/milestones-1-2"
RUNNER="$HOME/.clover-runner.sh"
if [ "$(cd "$(dirname "$0")" && pwd)/$(basename "$0")" != "$RUNNER" ]; then
  cp "$0" "$RUNNER"; chmod +x "$RUNNER"
  exec caffeinate -i bash "$RUNNER"
fi
while :; do
  cd "$HOME"
  SHA=$(curl -s "https://api.github.com/repos/$REPO/commits/$BRANCH" | grep -m1 '"sha"' | sed -E 's/.*"([0-9a-f]{40})".*/\1/')
  if curl -sfL -o ce.zip "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip"; then
    rm -rf ce-new && mkdir ce-new && unzip -q ce.zip -d ce-new && rm -rf clover-estimator-current \
      && mv ce-new/* clover-estimator-current && rm -rf ce-new
  fi
  echo "$(date '+%b %d %H:%M') starting worker version ${SHA:0:7}"
  cd "$HOME/clover-estimator-current" && BUILD_SHA="$SHA" bash scripts/mac-worker.sh
  echo "$(date '+%b %d %H:%M') worker stopped (code $?). Restarting in 10 seconds..."
  sleep 10
done
