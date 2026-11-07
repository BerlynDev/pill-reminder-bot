#!/usr/bin/env bash
# ============================================================
# First-time server setup (Ubuntu). Safe to run again.
#
#   git clone https://github.com/BerlynDev/pill-reminder-bot.git
#   cd pill-reminder-bot
#   bash deploy/setup.sh
#
# Installs Node.js + dependencies and registers the bot as a systemd
# service that starts on boot and restarts if it crashes. The service is
# only started once .env and pills.json exist (they never come from git).
# ============================================================
set -euo pipefail

SERVICE=pill-reminder
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then
    echo "Run this as your normal user (e.g. ubuntu), not root; it uses sudo when needed."
    exit 1
fi

# ---- 1. Node.js 18+ ------------------------------------------------
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$(node_major)" -lt 18 ]; then
    say "Installing Node.js 22 LTS"
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    say "Node.js $(node -v) already installed"
fi

# ---- 2. Dependencies -----------------------------------------------
say "Installing the bot's dependencies"
cd "$APP_DIR"
npm ci --omit=dev

# ---- 3. systemd service --------------------------------------------
say "Registering the '$SERVICE' service"
sudo tee "/etc/systemd/system/$SERVICE.service" > /dev/null <<EOF
[Unit]
Description=Pill reminder Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" > /dev/null

# ---- 4. Start (only when the private files are in place) -----------
missing=()
[ -f "$APP_DIR/.env" ] || missing+=(".env")
[ -f "$APP_DIR/pills.json" ] || missing+=("pills.json")

if [ ${#missing[@]} -gt 0 ]; then
    say "Almost done — copy these files from your PC into $APP_DIR:"
    printf '   • %s\n' "${missing[@]}"
    echo
    echo "   Then start the bot with:  sudo systemctl restart $SERVICE"
    echo "   (Remember to add TIMEZONE=America/Guayaquil to .env.)"
    exit 0
fi

if ! grep -q '^TIMEZONE=.\+' "$APP_DIR/.env"; then
    echo
    echo "⚠️  .env has no TIMEZONE — servers run on UTC, so pill times would be off."
    echo "   Add a line like:  TIMEZONE=America/Guayaquil"
fi

say "Starting the bot"
sudo systemctl restart "$SERVICE"
sleep 5
sudo systemctl --no-pager --lines=15 status "$SERVICE" || true

echo
echo "✅ Done. Useful commands:"
echo "   Live log:   journalctl -u $SERVICE -f"
echo "   Restart:    sudo systemctl restart $SERVICE"
echo "   Stop:       sudo systemctl stop $SERVICE"
echo "   Update:     bash deploy/update.sh"
