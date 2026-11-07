# Deploy: run the bot 24/7 on a free server

*Español: [DEPLOY.es.md](DEPLOY.es.md)*

The bot only makes **outgoing** connections to Telegram, so the server needs no website, domain, or open ports besides SSH. Any small **Ubuntu** server works (the bot uses ~50 MB of RAM).

**Two ways to host it:**
- **A cloud server** (Oracle / Google, free, needs a card): sections 1–5 below. Overview: create a server → connect with SSH → run `deploy/setup.sh` → copy `.env` and `pills.json` → stop the bot on your PC.
- **An Android phone** (free, no card): see **[Option C: Android phone](#option-c-android-phone-termux)** at the end.

> ⚠️ Only **one copy** of the bot may run at a time. When the server copy starts, stop the one on your PC.

---

## 1. Create the server

Pick one. Both need a card for identity verification; free-tier terms change, so double-check the provider's current free-tier page.

| | Oracle Cloud "Always Free" | Google Cloud "Free Tier" e2-micro |
|---|---|---|
| Cost | $0; account can't be charged unless you upgrade it | $0 if you stay inside the free limits; mistakes **can** be charged |
| Catch | Oracle may **reclaim idle** Always Free servers (this bot is mostly idle). If that happens, redo this guide (~15 min) | Only regions `us-west1`, `us-central1`, `us-east1`; 1 e2-micro, standard disk ≤ 30 GB |

### Option A: Oracle Cloud
1. Sign up at **cloud.oracle.com**. Choose your **home region** carefully, since it can't be changed (pick the closest, e.g. *Colombia Central (Bogotá)*).
2. Menu **☰ → Compute → Instances → Create instance**.
3. **Image:** *Canonical Ubuntu* (latest LTS). **Shape:** one marked **Always Free-eligible** (e.g. `VM.Standard.E2.1.Micro`, or Ampere `A1.Flex` with 1 OCPU / 6 GB).
4. **Networking:** keep the defaults, with *Assign a public IPv4 address* on.
5. **SSH keys:** *Generate a key pair for me* → **Save private key** (a `.key` file).
6. **Create**. When it's *Running*, copy the **Public IP address**. The user name is `ubuntu`.

### Option B: Google Cloud
1. **console.cloud.google.com** → **Compute Engine → VM instances → Create instance**.
2. **Region:** `us-central1`, `us-west1` or `us-east1`. **Machine type:** `e2-micro`.
3. **Boot disk:** Ubuntu (latest LTS), *Standard persistent disk*, ≤ 30 GB.
4. **Create**. Connect with the **SSH** button in the browser (no key file needed). To copy files, use that window's **⚙ → Upload file**.

---

## 2. Connect from Windows (Oracle / key file)

Move the key somewhere safe, e.g. `C:\Users\<you>\.ssh\pill-bot.key`, and restrict its permissions (otherwise SSH refuses it). In **PowerShell**:

```powershell
icacls $HOME\.ssh\pill-bot.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i $HOME\.ssh\pill-bot.key ubuntu@<PUBLIC-IP>
```

Answer `yes` the first time. You're in when the prompt looks like `ubuntu@...:~$`.

## 3. Install the bot (on the server)

```bash
git clone https://github.com/BerlynDev/pill-reminder-bot.git
cd pill-reminder-bot
bash deploy/setup.sh
```

It installs Node.js and the dependencies, and registers the bot as a **service** that starts on boot and restarts if it crashes. It stops at *"Almost done — copy these files…"* because your private files aren't there yet.

## 4. Copy your private files (from your PC)

These never go through GitHub. In **PowerShell on your PC**, inside the project folder:

```powershell
scp -i $HOME\.ssh\pill-bot.key .env pills.json ubuntu@<PUBLIC-IP>:~/pill-reminder-bot/
# optional, to keep your log and pending reminders:
scp -i $HOME\.ssh\pill-bot.key history.json state.json ubuntu@<PUBLIC-IP>:~/pill-reminder-bot/
```

(Google: upload them with **⚙ → Upload file**, then `mv ~/.env ~/pills.json ~/pill-reminder-bot/`.)

Then **on the server**, add your timezone. Servers run on UTC, and without this an 08:00 pill would arrive at 03:00:

```bash
echo 'TIMEZONE=America/Guayaquil' >> ~/pill-reminder-bot/.env
```

## 5. Switch over

1. On your PC: **Ctrl+C** in the bot's terminal (stop the local copy).
2. On the server:
   ```bash
   sudo systemctl restart pill-reminder
   journalctl -u pill-reminder -f
   ```
3. You should see `✅ Connected to Telegram`, `🕒 Timezone: America/Guayaquil — local time now …` (check it matches your clock) and get the startup message in Telegram. `Ctrl+C` exits the log view; the bot keeps running.

---

## Everyday operations (on the server)

| Task | Command |
|---|---|
| Live log | `journalctl -u pill-reminder -f` |
| Last 50 log lines | `journalctl -u pill-reminder -n 50` |
| Is it running? | `systemctl status pill-reminder` |
| Restart | `sudo systemctl restart pill-reminder` |
| Stop / start | `sudo systemctl stop pill-reminder` / `sudo systemctl start pill-reminder` |
| Edit pills | `nano ~/pill-reminder-bot/pills.json` (Ctrl+O save, Ctrl+X exit), then restart |
| Update after merging a PR | `cd ~/pill-reminder-bot && bash deploy/update.sh` |

**Back up your history** (from your PC):
```powershell
scp -i $HOME\.ssh\pill-bot.key ubuntu@<PUBLIC-IP>:~/pill-reminder-bot/history.json .\history-backup.json
```

**Run it on your PC again** (e.g. server gone): `sudo systemctl stop pill-reminder` on the server (if it still exists), then `npm start` on the PC.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `UNPROTECTED PRIVATE KEY FILE` / `Permission denied (publickey)` | Run the `icacls` line in step 2; check you use `ubuntu@` and the right key |
| SSH times out | Server stopped, wrong IP, or port 22 closed in the provider's firewall / security list |
| Reminders 5 h off | `TIMEZONE` missing in the server's `.env` → add it, restart |
| `Conflict: terminated by other getUpdates request` | The bot is still running on your PC too → stop one |
| `$'\r': command not found` | Script got Windows line endings; run `git checkout -- deploy/` (the repo enforces LF) |
| Service keeps restarting | `journalctl -u pill-reminder -n 50` shows the error (usually `.env` / `pills.json`) |

---

## Option C: Android phone (Termux)

Free and no card needed. Use a phone that can stay **plugged in and on Wi-Fi** (an old phone is ideal). iPhones can't do this.

### C1. Install the apps
1. Install **Termux** and **Termux:Boot** from **F-Droid** (f-droid.org) or Termux's GitHub releases. Both must come from the **same** source; the Google Play version is outdated.
2. Open **Termux:Boot** once (so Android lets it start Termux after a reboot).
3. Android settings → **Apps → Termux → Battery → Unrestricted** (also for Termux:Boot). On Samsung, also add Termux to *Never sleeping apps*; on Xiaomi, enable *Autostart*. More tips per brand: dontkillmyapp.com.

### C2. Install the bot (in Termux)
```bash
pkg install -y git
git clone https://github.com/BerlynDev/pill-reminder-bot.git
cd pill-reminder-bot
bash deploy/termux-setup.sh
```
It installs Node.js and the dependencies, and creates the auto-start script. It stops at *"Almost done — copy these files…"*.

### C3. Copy your private files (from your PC)
1. On the PC, copy `.env` and name the copy **`env.txt`** (phones hide files starting with a dot). Put `env.txt` and `pills.json` (and optionally `history.json`, `state.json`) in the phone's **Download** folder: USB cable, or Quick Share/Nearby Share. **Don't** send them through chat apps or cloud drives (they contain the bot token).
2. In Termux:
   ```bash
   termux-setup-storage        # allow access to the phone's storage (tap Allow)
   cp ~/storage/downloads/env.txt ~/pill-reminder-bot/.env
   cp ~/storage/downloads/pills.json ~/pill-reminder-bot/
   rm ~/storage/downloads/env.txt ~/storage/downloads/pills.json   # other apps can read Download!
   ```
The phone already uses your local time, so `TIMEZONE` isn't needed (add `TIMEZONE=America/Guayaquil` to `.env` if the phone might travel).

### C4. Switch over
1. On your PC: **Ctrl+C** in the bot's terminal (stop the local copy).
2. In Termux: `cd ~/pill-reminder-bot && bash deploy/termux-start.sh`
3. You should see `✅ Connected to Telegram` and get the startup message. Termux's notification shows **"wake lock held"**.
4. Leave Termux open in the background (don't swipe it away). After a reboot, Termux:Boot starts it by itself.

### Everyday operations (Android)
| Task | In Termux |
|---|---|
| See the log | `tail -f ~/pill-reminder.log` (Ctrl+C to stop watching) |
| Restart the bot | `pkill -f "node index.js"` (back within 10 s) |
| Stop completely | Ctrl+C in the session running `termux-start.sh` |
| Edit pills | `nano ~/pill-reminder-bot/pills.json` (Ctrl+O save, Ctrl+X exit), then restart |
| Update after merging a PR | `cd ~/pill-reminder-bot && bash deploy/termux-update.sh` |
| Back up history | `cp ~/pill-reminder-bot/history.json ~/storage/downloads/` |

If reminders stop arriving: check the phone is on, charging and online, that Termux still shows "wake lock held", and the battery settings in C1.
