# Pill Reminder Bot 💊

A personal Telegram bot that sends scheduled pill reminders and tracks adherence.

## Features
- Configurable pill schedule via `pills.json`
- Telegram reminders at the configured times, with **✅ Taken / ⏭️ Skip** buttons
- Re-sends until you answer
- Logs every answer to `history.json`
- Remembers unanswered reminders across restarts (`state.json`)
- Catches up on reminders missed while the bot was offline or the computer was asleep
- **Several people** from one bot, each with their own pills, language, history and commands
- **Caregiver alerts**: if someone doesn't answer after N reminders (default 3), their caregiver is told, and told again when they answer
- Only talks to the people in `pills.json`; everyone else is ignored
- Spanish (default) or English, per person
- No browser, no extra packages: just Node.js and the official Telegram Bot API

## Setup
1. In Telegram, message **@BotFather** → `/newbot` → pick a name and a username ending in `bot`. Copy the **token**.
2. `npm install`
3. Copy `.env.example` → `.env` and set `TELEGRAM_BOT_TOKEN`
4. `npm start` → with nobody configured yet, the bot starts in **setup mode**. Open your bot in Telegram and press **Start**; it replies with your chat ID.
5. Copy `pills.example.json` → `pills.json`, put your chat ID in the first person, add your medications, then restart with `npm start`

### Adding another person
1. They open the bot in Telegram and press **Start**. They get a "private bot" message with their chat ID, and **you** (the first person in `pills.json`) get a notice with their name and chat ID.
2. Add them to `"people"` in `pills.json` with that `chatId`, their pills, their `language`, and optionally `"caregivers": ["<your name>"]`.
3. Restart the bot. Only people in `pills.json` get reminders or answers.

## Answering reminders
Tap **✅ Taken** or **⏭️ Skip** on the reminder. That always answers that exact pill.

You can also type:

| Message | Answers |
|---|---|
| `YES` / `NO` | the only pill waiting for an answer |
| `YES` / `NO` as a reply to a reminder | the pill that reminder was for |
| `YES Aspirin` / `NO vit` | the pill matching that (partial) name |
| `YES 2` | pill #2 in the list the bot sends when it's unsure |
| `YES ALL` | every pill waiting for an answer |

If several pills are waiting and it's unclear which one you mean, the bot asks with one button per pill.
`SI`, `Y`, `N`, ✅, ❌, 👍 and 👎 work too.

Commands: `/status` (today's schedule and what's waiting), `/help`.

## Caregiver alerts
Give a person `"caregivers": ["Yo"]` (names of other people in `pills.json`). If they haven't answered a pill after `caregiverAlertAfterReminders` reminders (default **3**: the first one + 2 repeats), each caregiver gets, in their own language:

> ⚠️ **Mamá** no ha confirmado **Losartán** (07:00) después de 3 recordatorios.

The person keeps getting reminders. When they finally answer, caregivers get a follow-up (✅ confirmed / ⏭️ skipped).

## Language / Idioma
Each person's `"language"` in `pills.json` (`es` or `en`) wins; otherwise `BOT_LANGUAGE` in `.env` (default `es`) is used:

| Value | Bot speaks | Buttons | Commands |
|---|---|---|---|
| `es` (default) | Español | ✅ Tomada / ⏭️ Omitir | `/estado`, `/ayuda` |
| `en` | English | ✅ Taken / ⏭️ Skip | `/status`, `/help` |

Typed answers work in both: `YES`/`SÍ`/`SI`, `NO`, `YES ALL`/`SÍ TODAS`. Commands in either language are always accepted.
All texts live in `messages.js`; to add a language, copy the `en` block and translate it. Terminal logs stay in English.

## Missed reminders
If the bot wasn't running at a pill's time (restart, crash, computer asleep), it checks as soon as it's back:

| How late | What happens |
|---|---|
| Within `missedReminderWindowMinutes` (default 180) | Sends the reminder marked **(late)**, then nags as usual |
| Later than that | Sends a one-off ⚠️ *Missed reminder* notice; doesn't ask about that dose |

A pill that's new (or the very first run) whose time already passed today starts from its next scheduled time instead of sending an old reminder.

## `pills.json`
See `pills.example.json`.

| Field | Meaning |
|---|---|
| `people[].name` | Unique name (used in caregiver alerts and history) |
| `people[].chatId` | The number the bot replies with when they press **Start** |
| `people[].language` | `es` or `en` (optional; default `BOT_LANGUAGE`) |
| `people[].caregivers` | Optional list of other people's names to alert |
| `people[].pills[].name` | Unique per person, under ~60 characters |
| `people[].pills[].time` | 24-hour `HH:MM`, in `TIMEZONE` (or the computer's local time if unset) |
| `people[].pills[].dosage`, `.notes` | Shown in the reminder (both optional) |
| `reminderIntervalMinutes` | Minutes between repeat reminders |
| `missedReminderWindowMinutes` | Optional, default 180 (see above) |
| `caregiverAlertAfterReminders` | Optional, default 3 |

The **first person** is the owner: they get the startup message and are told when someone new presses Start.

The older single-person format (`{ "pills": [...] }` plus `TELEGRAM_CHAT_ID` in `.env`) still works.

## Run it 24/7 on a server
See **[DEPLOY.md](DEPLOY.md)** (español: [DEPLOY.es.md](DEPLOY.es.md)): a free Ubuntu server (Oracle Cloud or Google Cloud), `deploy/setup.sh` to install it as an auto-restarting service, and `deploy/update.sh` after merging changes. Set `TIMEZONE` in `.env` on servers.

## Tech
Node.js 18+ (built-in `fetch`) talking to the [Telegram Bot API](https://core.telegram.org/bots/api) with long polling, so no public URL or webhook is needed.
