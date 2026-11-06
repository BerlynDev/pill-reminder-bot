# Pill Reminder Bot 💊

A personal Telegram bot that sends scheduled pill reminders and tracks adherence.

## Features
- Configurable pill schedule via `pills.json`
- Telegram reminders at the configured times, with **✅ Taken / ⏭️ Skip** buttons
- Re-sends until you answer
- Logs every answer to `history.json`
- Remembers unanswered reminders across restarts (`state.json`)
- Catches up on reminders missed while the bot was offline or the computer was asleep
- Only talks to you: messages from anyone else are ignored
- Spanish (default) or English (`BOT_LANGUAGE=es` / `en` in `.env`)
- No browser, no extra packages: just Node.js and the official Telegram Bot API

## Setup
1. In Telegram, message **@BotFather** → `/newbot` → pick a name and a username ending in `bot`. Copy the **token**.
2. `npm install`
3. Copy `.env.example` → `.env` and set `TELEGRAM_BOT_TOKEN`
4. Copy `pills.example.json` → `pills.json` and add your medications
5. `npm start` → the bot starts in **setup mode**. Open your bot in Telegram and press **Start**; it replies with your chat ID.
6. Put that in `.env` as `TELEGRAM_CHAT_ID`, then restart with `npm start`

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

## Language / Idioma
Set `BOT_LANGUAGE` in `.env`:

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
| Field | Meaning |
|---|---|
| `pills[].name` | Unique name, under ~60 characters |
| `pills[].time` | 24-hour `HH:MM`, in the computer's local time |
| `pills[].dosage`, `pills[].notes` | Shown in the reminder (`notes` optional) |
| `reminderIntervalMinutes` | Minutes between repeat reminders |
| `missedReminderWindowMinutes` | Optional, default 180 (see above) |

## Tech
Node.js 18+ (built-in `fetch`) talking to the [Telegram Bot API](https://core.telegram.org/bots/api) with long polling, so no public URL or webhook is needed.
