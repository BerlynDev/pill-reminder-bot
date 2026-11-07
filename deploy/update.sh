#!/usr/bin/env bash
# ============================================================
# Update the bot on the server to the latest main from GitHub.
# Run after merging a pull request:
#
#   cd ~/pill-reminder-bot && bash deploy/update.sh
#
# .env, pills.json, state.json and history.json are never touched.
# ============================================================
set -euo pipefail

SERVICE=pill-reminder
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

before="$(git rev-parse --short HEAD)"
git pull --ff-only
after="$(git rev-parse --short HEAD)"

if [ "$before" = "$after" ]; then
    echo "Already up to date ($after). Restarting anyway."
else
    echo "Updated $before → $after:"
    git log --oneline "$before..$after"
fi

npm ci --omit=dev
sudo systemctl restart "$SERVICE"
sleep 5
journalctl -u "$SERVICE" -n 15 --no-pager
