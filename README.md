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

Only replies from you, in your chat with the bot, count: a "yes" sent to a friend or a group is ignored.

## Setup
1. `npm install`
2. Copy `.env.example` → `.env` and set `MY_WHATSAPP_NUMBER` to the number that should **receive** reminders
3. Copy `pills.example.json` → `pills.json` and add your medications
4. `node index.js`
5. On first run, scan the QR code (WhatsApp → Settings → Linked devices → Link a device)

### One number or two?
| You scan the QR with… | Reminders arrive… | Notes |
|---|---|---|
| a **second** number (recommended) | as a normal chat from the bot number | You get regular notifications; your main account isn't the one automated |
| the **same** number as `MY_WHATSAPP_NUMBER` | in your "Message yourself" chat | Messages sent from a linked device to yourself may not notify you |

The bot detects which setup you're using on startup.

> If `npm install` reports that Puppeteer's install script was skipped, download its browser with
> `npx puppeteer browsers install chrome`.

## Tech
Built with [whatsapp-web.js](https://wwebjs.dev/) on Node.js.