#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# First-time setup on an Android phone with Termux. Safe to run again.
#
#   pkg install -y git
#   git clone https://github.com/BerlynDev/pill-reminder-bot.git
#   cd pill-reminder-bot
#   bash deploy/termux-setup.sh
#
# Installs Node.js + dependencies and creates a Termux:Boot script so the
# bot starts by itself after the phone restarts.
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [[ "${PREFIX:-}" != *com.termux* ]]; then
    echo "This script is for Termux on Android. On a Linux server use deploy/setup.sh."
    exit 1
fi

# ---- 1. Packages ----------------------------------------------------
say "Installing Node.js, git and process tools"
pkg install -y nodejs-lts git procps termux-tools

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 18 ]; then
    echo "Node.js $(node -v) is too old (need 18+). Run: pkg upgrade"
    exit 1
fi

# ---- 2. Dependencies -----------------------------------------------
say "Installing the bot's dependencies"
cd "$APP_DIR"
npm ci --omit=dev

# ---- 3. Auto-start after reboot (needs the Termux:Boot app) ---------
say "Creating the Termux:Boot start script"
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/pill-reminder" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
# Started by Termux:Boot when the phone turns on
cd "$APP_DIR" && exec bash deploy/termux-start.sh
EOF
chmod +x "$HOME/.termux/boot/pill-reminder"
echo "   Created ~/.termux/boot/pill-reminder"
echo "   Install the Termux:Boot app (same store as Termux) and open it ONCE."

# ---- 4. Private files ----------------------------------------------
missing=()
[ -f "$APP_DIR/.env" ] || missing+=(".env")
[ -f "$APP_DIR/pills.json" ] || missing+=("pills.json")

if [ ${#missing[@]} -gt 0 ]; then
    say "Almost done — copy these files from your PC into $APP_DIR:"
    printf '   • %s\n' "${missing[@]}"
    echo
    echo "   See DEPLOY.es.md, Opción C, for how to copy them safely."
    echo "   Then start the bot with:  bash deploy/termux-start.sh"
    exit 0
fi

say "Setup complete. Start the bot with:  bash deploy/termux-start.sh"
