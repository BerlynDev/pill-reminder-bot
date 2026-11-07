#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# Run the bot on Android (Termux) and keep it running:
#   - holds a wake lock so Android doesn't put Termux to sleep
#   - restarts the bot 10 s after it stops or crashes
#   - writes the log to ~/pill-reminder.log (and to the screen)
#
#   cd ~/pill-reminder-bot && bash deploy/termux-start.sh
#
# Stop it with Ctrl+C (or: pkill -f termux-start.sh; pkill -f "node index.js")
# ============================================================
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/pill-reminder.log"
cd "$APP_DIR"

# Only one copy may talk to Telegram at a time
if pgrep -f "node index.js" > /dev/null; then
    echo "The bot is already running. To restart it: pkill -f \"node index.js\" (it comes back in 10 s)."
    exit 0
fi

termux-wake-lock 2>/dev/null || echo "⚠️  Could not take a wake lock; Android may pause the bot."
trap 'echo; echo "Stopped."; termux-wake-unlock 2>/dev/null; exit 0' INT TERM

# Keep the log from growing forever (~2 MB)
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2000000 ]; then
    tail -c 1000000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

while true; do
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') starting the bot ===" | tee -a "$LOG"
    node index.js 2>&1 | tee -a "$LOG"
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') bot stopped — restarting in 10 s (Ctrl+C to quit) ===" | tee -a "$LOG"
    sleep 10
done
