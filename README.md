# Pill Reminder Bot 💊

A personal WhatsApp bot that sends scheduled pill reminders and tracks adherence.

## Features
- Configurable pill schedule via `pills.json`
- WhatsApp reminders at the configured times
- Re-sends until you confirm with "YES"
- Logs every response to `history.json`
- Remembers unanswered reminders across restarts (`state.json`)

## Replying
| Reply | Marks |
|---|---|
| `YES` / `NO` | the only pill waiting for a reply |
| `YES` / `NO` as a reply to a reminder message | the pill that reminder was for |
| `YES Aspirin` / `NO vit` | the pill matching that (partial) name |
| `YES 2` | pill #2 in the list the bot sends when it's unsure |
| `YES ALL` | every pill waiting for a reply |

If several pills are waiting and it's unclear which one you mean, the bot asks instead of guessing.
`SI`, `Y`, `N`, ✅, ❌, 👍 and 👎 work too.

## Setup
1. `npm install`
2. Copy `.env.example` → `.env` and fill in your WhatsApp number
3. Copy `pills.example.json` → `pills.json` and add your medications
4. `node index.js`
5. Scan the QR code with WhatsApp on first run

## Tech
Built with [whatsapp-web.js](https://wwebjs.dev/) on Node.js.