// ============================================================
// PILL REMINDER BOT (Telegram)
// ============================================================

// Load environment variables from .env into process.env
require('dotenv').config({ quiet: true });

const fs = require('fs');                              // built-in: read/write files
const { createTelegram } = require('./telegram');
const { loadState, saveState } = require('./state');
const { parseReply, resolveTargets } = require('./replies');
const { reminderAction, DEFAULT_MISSED_WINDOW_MINUTES } = require('./schedule');

// ------------------------------------------------------------
// CONSTANTS & SETTINGS
// ------------------------------------------------------------
const HISTORY_FILE = './history.json';
const STATE_FILE = './state.json';
const TICK_SECONDS = 20;

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
// The one chat the bot talks to (yours). Empty → setup mode (see /start).
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set in .env — create a bot with @BotFather to get one.');
    process.exit(1);
}
const tg = createTelegram(TOKEN);

// ------------------------------------------------------------
// LOAD PILL CONFIG
// ------------------------------------------------------------
function loadPills() {
    try {
        const fileContents = fs.readFileSync('./pills.json', 'utf8');
        const config = JSON.parse(fileContents);
        const names = new Set();
        for (const pill of config.pills) {
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pill.time)) {
                throw new Error(`"${pill.name}" has time "${pill.time}" — use 24-hour HH:MM, e.g. "08:00" or "21:30"`);
            }
            // The name travels inside button data, which Telegram caps at 64 bytes
            if (Buffer.byteLength(pill.name, 'utf8') > 60) {
                throw new Error(`"${pill.name}" is too long — keep pill names under ~60 characters`);
            }
            if (names.has(pill.name)) throw new Error(`"${pill.name}" appears twice — pill names must be unique`);
            names.add(pill.name);
        }
        console.log(`💊 Loaded ${config.pills.length} pill(s) from pills.json`);
        return config;
    } catch (err) {
        console.error('❌ Failed to load pills.json:', err.message);
        process.exit(1);
    }
}

// ------------------------------------------------------------
// HISTORY LOG — append a record to history.json
// ------------------------------------------------------------
function logResponse(entry) {
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            const text = fs.readFileSync(HISTORY_FILE, 'utf8');
            history = text.trim() ? JSON.parse(text) : [];
        } catch (err) {
            console.error('⚠️  Could not parse history.json, starting fresh:', err.message);
            history = [];
        }
    }
    history.push(entry);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    console.log(`📝 Logged: ${entry.response.toUpperCase()} for ${entry.pillName}`);
}

// ------------------------------------------------------------
// STATE — saved to state.json so a restart doesn't lose anything
// ------------------------------------------------------------
const config = loadPills();

// Pills currently waiting for an answer.
// Map<pillName, { firstSentAt: Date, lastSentAt: Date,
//                 remindersSent: number, messageIds: number[] }>
// When each pill was last reminded/handled (see schedule.js).
// Map<pillName, Date>
const { pending: pendingReminders, lastFiredAt } = loadState(STATE_FILE);

function persist() {
    try {
        saveState(STATE_FILE, { pending: pendingReminders, lastFiredAt });
    } catch (err) {
        console.error('⚠️  Could not save state.json:', err.message);
    }
}

// Drop pending reminders for pills that were removed from pills.json
for (const name of pendingReminders.keys()) {
    if (!config.pills.some(p => p.name === name)) {
        pendingReminders.delete(name);
        console.log(`🗑️  "${name}" is no longer in pills.json, dropping its pending reminder`);
    }
}
persist();

if (pendingReminders.size > 0) {
    console.log(`⏳ Restored ${pendingReminders.size} pending reminder(s) from ${STATE_FILE}`);
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

// Messages use Telegram's HTML formatting, so escape anything from pills.json
function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Pending pill names, oldest reminder first (used for numbered lists)
function pendingNames() {
    return [...pendingReminders]
        .sort((a, b) => a[1].firstSentAt - b[1].firstSentAt)
        .map(([name]) => name);
}

function numberedList(names) {
    return names.map((name, i) => `${i + 1}. ${esc(name)}`).join('\n');
}

// Which pending pill a reminder message belongs to (null if none)
function pillForMessageId(messageId) {
    for (const [name, info] of pendingReminders) {
        if (info.messageIds.includes(messageId)) return name;
    }
    return null;
}

// Button data is "y:<pill name>" (taken) or "n:<pill name>" (skipped)
function answerButtons(pillName) {
    return [[
        { text: '✅ Taken', callback_data: `y:${pillName}` },
        { text: '⏭️ Skip', callback_data: `n:${pillName}` }
    ]];
}

// Send a message to you. Returns the sent message (with message_id).
function send(text, buttons) {
    return tg.call('sendMessage', {
        chat_id: CHAT_ID,
        text: text.trimEnd(),
        parse_mode: 'HTML',
        ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {})
    });
}

// Remove the buttons from a message (best effort — it may be too old to edit)
function removeButtons(messageId) {
    return tg.call('editMessageReplyMarkup', {
        chat_id: CHAT_ID,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
    }).catch(() => {});
}

// ------------------------------------------------------------
// ANSWERING — shared by buttons and typed YES/NO
// ------------------------------------------------------------
async function answerPills(pillNames, response) {
    for (const pillName of pillNames) {
        const info = pendingReminders.get(pillName);
        if (!info) continue;
        pendingReminders.delete(pillName);

        logResponse({
            timestamp: new Date().toISOString(),
            pillName,
            response,
            remindersSent: info.remindersSent,
            originalReminderAt: info.firstSentAt.toISOString()
        });

        // Old reminders for this dose shouldn't stay clickable
        await Promise.all(info.messageIds.map(removeButtons));
    }
    persist();
    console.log(`   ✅ Cleared ${pillNames.join(', ')} from pending (${pendingReminders.size} remaining)`);

    const pillList = pillNames.map(n => `<b>${esc(n)}</b>`).join(', ');
    let ack = response === 'yes'
        ? `🎉 Great! Logged that you took your ${pillList}. Stay healthy! 💪`
        : `⏭️ Noted — you skipped ${pillList}. I won't keep reminding you.`;
    if (pendingReminders.size > 0) {
        ack += `\n\nStill waiting on:\n${numberedList(pendingNames())}`;
    }
    await send(ack);
}

// ------------------------------------------------------------
// MAIN TICK — runs every 20s.
// Handles initial reminders AND nags in one place.
// ------------------------------------------------------------
// With network retries a tick can take longer than 20s; never run two at once
let tickRunning = false;
async function tick() {
    if (tickRunning) return;
    tickRunning = true;
    try {
        await runTick();
    } catch (err) {
        console.error('❌ Error during reminder check:', err.message);
    } finally {
        tickRunning = false;
    }
}

async function runTick() {
    const now = new Date();
    const windowMinutes = config.missedReminderWindowMinutes ?? DEFAULT_MISSED_WINDOW_MINUTES;

    // ---- 1. Send reminders that are due (or were missed while offline) ----
    for (const pill of config.pills) {
        const previous = lastFiredAt.get(pill.name);
        const { action, dueAt } = reminderAction(pill, now, previous, windowMinutes);
        if (action === 'none') continue;

        if (action === 'start_next') {
            // New pill (or first run) and today's time already passed:
            // don't surprise you with an old reminder, start next time.
            lastFiredAt.set(pill.name, now);
            persist();
            console.log(`📅 "${pill.name}" was due at ${pill.time}, before the bot knew about it — first reminder next time`);
            continue;
        }

        let text;
        let buttons = null;
        if (action === 'missed') {
            text =
                `⚠️ <b>Missed reminder</b>\n\n` +
                `I was offline at ${pill.time}, when your <b>${esc(pill.name)}</b> (${esc(pill.dosage)}) was due, ` +
                `and that was more than ${windowMinutes} min ago, so I won't ask about this dose.`;
        } else {
            const late = action === 'send_late';
            text =
                `💊 <b>Pill Reminder</b>${late ? ' (late)' : ''}\n\n` +
                (late
                    ? `This was due at ${pill.time} — time to take your <b>${esc(pill.name)}</b> (${esc(pill.dosage)}).\n` +
                      `<i>I was offline or asleep at ${pill.time}, so this reminder is late.</i>\n`
                    : `It's ${pill.time} — time to take your <b>${esc(pill.name)}</b> (${esc(pill.dosage)}).\n`) +
                (pill.notes ? `📝 <i>${esc(pill.notes)}</i>\n` : '');
            buttons = answerButtons(pill.name);
        }

        // Mark as handled BEFORE sending, so a slow send can't let the next
        // tick send it again. Undone below if the send fails, to retry.
        lastFiredAt.set(pill.name, now);

        try {
            const sent = await send(text, buttons);
            const sentAt = new Date();
            const lateBy = Math.round((sentAt - dueAt) / 60000);

            if (action === 'missed') {
                console.log(`⚠️  Missed ${pill.name} (due ${pill.time}, ${lateBy} min ago) — told you, not asking`);
                persist();
                continue;
            }

            console.log(`⏰ [${sentAt.toLocaleTimeString()}] Sent reminder for ${pill.name}` +
                (action === 'send_late' ? ` (late by ${lateBy} min)` : ''));

            // If yesterday's dose was never answered, retire its buttons
            const stale = pendingReminders.get(pill.name);
            if (stale) await Promise.all(stale.messageIds.map(removeButtons));

            pendingReminders.set(pill.name, {
                firstSentAt: sentAt,
                lastSentAt: sentAt,
                remindersSent: 1,
                messageIds: [sent.message_id]
            });
            persist();
        } catch (err) {
            if (previous) lastFiredAt.set(pill.name, previous);
            else lastFiredAt.delete(pill.name);
            console.error(`❌ Failed to send reminder for ${pill.name}:`, err.message);
        }
    }

    // ---- 2. Nag any pending reminders whose interval has elapsed ----
    for (const [pillName, info] of pendingReminders) {
        const minsAgo = (new Date() - info.lastSentAt) / 60000;
        if (minsAgo < config.reminderIntervalMinutes) continue;

        const nagText =
            `🔁 <b>Still waiting on you!</b>\n\n` +
            `Did you take your <b>${esc(pillName)}</b> yet?\n` +
            `(This is reminder #${info.remindersSent + 1})`;

        try {
            const sent = await send(nagText, answerButtons(pillName));
            console.log(`🔁 Nag #${info.remindersSent + 1} sent for ${pillName} (${minsAgo.toFixed(1)} min since last)`);
            info.lastSentAt = new Date();
            info.remindersSent += 1;
            info.messageIds.push(sent.message_id);
            persist();
        } catch (err) {
            console.error(`❌ Failed to send nag for ${pillName}:`, err.message);
        }
    }
}

// ------------------------------------------------------------
// BUTTON PRESSES (✅ Taken / ⏭️ Skip)
// ------------------------------------------------------------
async function handleButton(query) {
    const done = (text) => tg.call('answerCallbackQuery', {
        callback_query_id: query.id,
        ...(text ? { text } : {})
    }).catch(() => {});

    if (!CHAT_ID || !query.message || String(query.message.chat.id) !== CHAT_ID) {
        await done();
        return;
    }

    const data = query.data || '';
    const separator = data.indexOf(':');
    const code = data.slice(0, Math.max(separator, 0));
    const pillName = data.slice(separator + 1);
    const response = code === 'y' ? 'yes' : code === 'n' ? 'no' : null;
    if (!response) {
        await done();
        return;
    }

    console.log(`🔘 Button: ${response.toUpperCase()} for ${pillName}`);

    if (!pendingReminders.has(pillName)) {
        await done('This dose was already answered.');
        await removeButtons(query.message.message_id);
        return;
    }

    await done(response === 'yes' ? `✅ ${pillName} logged` : `⏭️ ${pillName} skipped`);
    await removeButtons(query.message.message_id);  // e.g. the "which one?" question
    await answerPills([pillName], response);
}

// ------------------------------------------------------------
// TEXT MESSAGES — commands and typed YES/NO
//
// Typed replies (buttons are easier, but these work too):
//   YES / NO                    → the only waiting pill
//   YES / NO replying to a reminder → the pill that reminder was for
//   YES Aspirin / NO vit        → pill by (partial) name
//   YES 2                       → pill #2 in the "which one?" list
//   YES ALL                     → every waiting pill
// ------------------------------------------------------------
async function handleMessage(message) {
    if (!message.text || (message.from && message.from.is_bot)) return;
    const chatId = String(message.chat.id);
    const command = message.text.trim().split(/[\s@]/)[0].toLowerCase();

    // ---- Setup mode: no TELEGRAM_CHAT_ID yet → tell the user theirs ----
    if (!CHAT_ID) {
        if (command === '/start') {
            console.log(`🆔 /start from chat ID ${chatId} — put TELEGRAM_CHAT_ID=${chatId} in .env and restart`);
            await tg.call('sendMessage', {
                chat_id: chatId,
                text: `👋 Almost ready!\n\nYour chat ID is ${chatId}.\n` +
                      `Add this line to the bot's .env file and restart it:\n\nTELEGRAM_CHAT_ID=${chatId}`
            });
        }
        return;
    }

    // ---- Only you: ignore everyone else who finds the bot ----
    if (chatId !== CHAT_ID) {
        console.log('↪️  Ignored a message from another Telegram chat');
        return;
    }

    if (command === '/start' || command === '/help') {
        await send(
            `👋 <b>Pill reminder bot</b>\n\n` +
            `I'll message you at each pill's time. Tap <b>✅ Taken</b> or <b>⏭️ Skip</b> on the reminder, ` +
            `or type <b>YES</b> / <b>NO</b>.\n\n` +
            `If more than one pill is waiting, tap the buttons on the right reminder, ` +
            `or type e.g. <b>YES Aspirin</b>, <b>YES 2</b> or <b>YES ALL</b>.\n\n` +
            `/status — today's schedule and what's waiting`);
        return;
    }
    if (command === '/status') {
        const schedule = [...config.pills]
            .sort((a, b) => a.time.localeCompare(b.time))
            .map(p => `• ${p.time} — <b>${esc(p.name)}</b> (${esc(p.dosage)})` +
                (pendingReminders.has(p.name) ? ' ⏳ waiting' : ''))
            .join('\n');
        await send(`📋 <b>Your pills</b>\n${schedule}\n\n` +
            (pendingReminders.size > 0
                ? `⏳ Waiting for an answer:\n${numberedList(pendingNames())}`
                : `✅ Nothing waiting for an answer.`));
        return;
    }

    const parsed = parseReply(message.text);
    if (!parsed) return;  // not a YES/NO — ignore

    const names = pendingNames();

    // "y mañana compro leche" with nothing pending is just a note, not a reply
    if (parsed.target && names.length === 0) return;

    console.log(`💬 Got reply "${message.text}" → ${parsed.response.toUpperCase()}` +
        (parsed.target ? ` for "${parsed.target}"` : ''));

    // If you replied to a reminder, use the pill it was for.
    // Replying to any other message is ignored.
    let quote = null;
    const replied = message.reply_to_message;
    if (replied) {
        const pillName = pillForMessageId(replied.message_id);
        const isReminder = /^(💊 Pill Reminder|🔁 Still waiting on you!)/.test(replied.text || '');
        if (pillName || isReminder) quote = { pillName };
        console.log(pillName
            ? `   ↩️  Reply to the reminder for ${pillName}`
            : `   ↩️  Reply to a message that isn't a waiting reminder`);
    }

    const result = resolveTargets(parsed.target, names, quote);
    const word = parsed.response.toUpperCase();

    if (result.status === 'none_pending') {
        await send(`🤔 No pill reminders are waiting for an answer right now.`);
        return;
    }
    if (result.status === 'stale_quote') {
        await send(`🤔 That reminder isn't waiting for an answer anymore.\n\n` +
            `Still waiting on:\n${numberedList(names)}`);
        return;
    }
    if (result.status === 'ambiguous' || result.status === 'not_found') {
        const intro =
            result.status === 'not_found' ? `❓ I couldn't find a waiting pill called "${esc(parsed.target)}".` :
            parsed.target ? `❓ More than one waiting pill matches "${esc(parsed.target)}". Which one?` :
            `❓ More than one pill is waiting. Which one is this for?`;
        // One button per waiting pill, carrying the YES/NO you typed
        const code = parsed.response === 'yes' ? 'y' : 'n';
        const emoji = parsed.response === 'yes' ? '✅' : '⏭️';
        await send(`${intro}\n\nTap one below, or type <b>${word} ALL</b>.`,
            names.map(name => [{ text: `${emoji} ${name}`, callback_data: `${code}:${name}` }]));
        return;
    }

    await answerPills(result.pills, parsed.response);
}

// ------------------------------------------------------------
// POLLING — ask Telegram for new messages/button presses (long polling,
// so no public URL or webhook is needed)
// ------------------------------------------------------------
async function pollForever() {
    let offset = 0;
    for (;;) {
        try {
            const updates = await tg.call('getUpdates', {
                offset,
                timeout: 30,
                allowed_updates: ['message', 'callback_query']
            });
            for (const update of updates) {
                offset = update.update_id + 1;
                try {
                    if (update.message) await handleMessage(update.message);
                    else if (update.callback_query) await handleButton(update.callback_query);
                } catch (err) {
                    console.error('❌ Error handling a Telegram update:', err.message);
                }
            }
        } catch (err) {
            console.error(`⚠️  ${err.message} — retrying in 5s`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// ------------------------------------------------------------
// START THE BOT
// ------------------------------------------------------------
async function main() {
    console.log('🚀 Starting the pill reminder bot...');

    // Keep trying while the internet is down (e.g. right after the computer
    // wakes up); only give up if Telegram rejects the token.
    let me;
    for (;;) {
        try {
            me = await tg.call('getMe');
            break;
        } catch (err) {
            if (!err.network && err.code !== 429) {
                console.error(`❌ Telegram rejected the bot: ${err.message}`);
                console.error('   Check TELEGRAM_BOT_TOKEN in .env (the full "number:letters" token from @BotFather).');
                process.exit(1);
            }
            console.error(`⚠️  Can't reach Telegram yet (${err.message}) — retrying in 15s`);
            await new Promise(resolve => setTimeout(resolve, 15000));
        }
    }
    console.log(`✅ Connected to Telegram as @${me.username}`);
    console.log('   Press Ctrl+C to stop the bot.');

    await tg.call('setMyCommands', {
        commands: [
            { command: 'status', description: "Today's schedule and what's waiting" },
            { command: 'help', description: 'How to answer reminders' }
        ]
    }).catch(err => console.error('⚠️  Could not set bot commands:', err.message));

    if (!CHAT_ID) {
        console.log('');
        console.log('🔧 Setup mode: TELEGRAM_CHAT_ID is not set in .env.');
        console.log(`   Open https://t.me/${me.username} in Telegram and press Start.`);
        console.log('   The bot will reply with your chat ID.');
        await pollForever();
        return;
    }

    // Startup message listing loaded pills (and anything still unanswered)
    const pillList = config.pills
        .map(p => `  • ${p.time} — ${esc(p.name)} (${esc(p.dosage)})`)
        .join('\n');
    let message =
        `👋 Pill reminder bot is online!\n\n` +
        `Loaded ${config.pills.length} pill(s):\n${pillList}\n\n` +
        `I'll remind you every ${config.reminderIntervalMinutes} min ` +
        `until you answer.`;
    if (pendingReminders.size > 0) {
        message += `\n\n⏳ Still waiting on an answer for:\n${numberedList(pendingNames())}`;
    }

    try {
        await send(message);
        console.log('📤 Sent startup message');
    } catch (err) {
        console.error('❌ Failed to send startup message:', err.message);
        console.error('   Is TELEGRAM_CHAT_ID right, and did you press Start in the bot chat?');
    }

    config.pills.forEach(p => {
        console.log(`📅 Will remind for "${p.name}" daily at ${p.time}`);
    });
    console.log(`🔁 Checking every ${TICK_SECONDS}s (nag interval: ${config.reminderIntervalMinutes} min)`);

    // First tick right away, so reminders missed while offline go out now.
    tick();
    setInterval(tick, TICK_SECONDS * 1000);

    await pollForever();
}

main();
