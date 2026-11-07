#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# Update the bot on Android (Termux) to the latest main from GitHub.
#
#   cd ~/pill-reminder-bot && bash deploy/termux-update.sh
#
# If termux-start.sh is running, it restarts the bot with the new code
# within 10 s. .env, pills.json, state.json and history.json are never touched.
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

before="$(git rev-parse --short HEAD)"
git pull --ff-only
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then
    echo "Already up to date ($after)."
else
    echo "Updated $before → $after:"
    git log --oneline "$before..$after"
fi

npm ci --omit=dev

if pkill -f "node index.js"; then
    echo "Restarting the bot — it's back within 10 s (see ~/pill-reminder.log)."
else
    echo "The bot wasn't running. Start it with: bash deploy/termux-start.sh"
fi
