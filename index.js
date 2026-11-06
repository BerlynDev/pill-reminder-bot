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
const { getMessages, COMMAND_ALIASES, REMINDER_TITLES } = require('./messages');

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

// What the bot says in Telegram (messages.js). Logs stay in English.
let t;
try {
    t = getMessages(process.env.BOT_LANGUAGE);
} catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
}

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
        { text: t.taken, callback_data: `y:${pillName}` },
        { text: t.skip, callback_data: `n:${pillName}` }
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
    let ack = response === 'yes' ? t.ackTaken(pillList) : t.ackSkipped(pillList);
    if (pendingReminders.size > 0) {
        ack += `\n\n${t.stillWaiting}\n${numberedList(pendingNames())}`;
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
        const name = esc(pill.name);
        const dosage = esc(pill.dosage);
        if (action === 'missed') {
            text = t.missed(pill.time, name, dosage, windowMinutes);
        } else {
            const late = action === 'send_late';
            text =
                `<b>${t.reminderTitle}</b>${late ? t.late : ''}\n\n` +
                (late ? t.dueLate(pill.time, name, dosage) : t.dueNow(pill.time, name, dosage)) + '\n' +
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

        const nagText = `<b>${t.nagTitle}</b>\n\n` + t.nag(esc(pillName), info.remindersSent + 1);

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
        await done(t.toastAlreadyAnswered);
        await removeButtons(query.message.message_id);
        return;
    }

    await done(response === 'yes' ? t.toastTaken(pillName) : t.toastSkipped(pillName));
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
    const firstWord = message.text.trim().split(/[\s@]/)[0].toLowerCase();
    const command = COMMAND_ALIASES[firstWord];   // 'help' | 'status' | undefined

    // ---- Setup mode: no TELEGRAM_CHAT_ID yet → tell the user theirs ----
    if (!CHAT_ID) {
        if (firstWord === '/start') {
            console.log(`🆔 /start from chat ID ${chatId} — put TELEGRAM_CHAT_ID=${chatId} in .env and restart`);
            await tg.call('sendMessage', { chat_id: chatId, text: t.setup(chatId) });
        }
        return;
    }

    // ---- Only you: ignore everyone else who finds the bot ----
    if (chatId !== CHAT_ID) {
        console.log('↪️  Ignored a message from another Telegram chat');
        return;
    }

    if (command === 'help') {
        await send(t.help);
        return;
    }
    if (command === 'status') {
        const schedule = [...config.pills]
            .sort((a, b) => a.time.localeCompare(b.time))
            .map(p => `• ${p.time} — <b>${esc(p.name)}</b> (${esc(p.dosage)})` +
                (pendingReminders.has(p.name) ? t.statusWaitingTag : ''))
            .join('\n');
        await send(`${t.statusTitle}\n${schedule}\n\n` +
            (pendingReminders.size > 0
                ? `${t.statusWaiting}\n${numberedList(pendingNames())}`
                : t.statusNothingWaiting));
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
        const isReminder = REMINDER_TITLES.some(title => (replied.text || '').startsWith(title));
        if (pillName || isReminder) quote = { pillName };
        console.log(pillName
            ? `   ↩️  Reply to the reminder for ${pillName}`
            : `   ↩️  Reply to a message that isn't a waiting reminder`);
    }

    const result = resolveTargets(parsed.target, names, quote);
    const word = parsed.response === 'yes' ? t.yesWord : t.noWord;

    if (result.status === 'none_pending') {
        await send(t.noneWaiting);
        return;
    }
    if (result.status === 'stale_quote') {
        await send(`${t.staleReply}\n\n${t.stillWaiting}\n${numberedList(names)}`);
        return;
    }
    if (result.status === 'ambiguous' || result.status === 'not_found') {
        const intro =
            result.status === 'not_found' ? t.notFound(esc(parsed.target)) :
            parsed.target ? t.ambiguousMatch(esc(parsed.target)) :
            t.ambiguous;
        // One button per waiting pill, carrying the YES/NO you typed
        const code = parsed.response === 'yes' ? 'y' : 'n';
        const emoji = parsed.response === 'yes' ? '✅' : '⏭️';
        await send(`${intro}\n\n${t.pickOne(word)}`,
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

    // The "/" menu in Telegram, in the bot's language
    await tg.call('setMyCommands', { commands: t.commands })
        .catch(err => console.error('⚠️  Could not set bot commands:', err.message));

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
    let message = t.online(config.pills.length, pillList, config.reminderIntervalMinutes);
    if (pendingReminders.size > 0) {
        message += `\n\n${t.onlineWaiting}\n${numberedList(pendingNames())}`;
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
