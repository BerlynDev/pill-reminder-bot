// ============================================================
// PILL REMINDER BOT (Telegram) — one bot, one or more people
// ============================================================

// Load environment variables from .env into process.env
require('dotenv').config({ quiet: true });

// Pill times in pills.json are in this timezone. Servers usually run on
// UTC, so without it an 08:00 pill would fire at 08:00 UTC (03:00 in
// Ecuador). Must be set before any date is handled.
const TIMEZONE = (process.env.TIMEZONE || '').trim();
if (TIMEZONE) {
    try {
        new Intl.DateTimeFormat('en', { timeZone: TIMEZONE });   // throws if unknown
    } catch (err) {
        console.error(`❌ TIMEZONE "${TIMEZONE}" isn't a valid timezone — use e.g. America/Guayaquil`);
        process.exit(1);
    }
    process.env.TZ = TIMEZONE;
}

const fs = require('fs');                              // built-in: read/write files
const { createTelegram } = require('./telegram');
const { loadState, saveState } = require('./state');
const { parseReply, resolveTargets } = require('./replies');
const { reminderAction, DEFAULT_MISSED_WINDOW_MINUTES } = require('./schedule');
const { getMessages, COMMAND_ALIASES, REMINDER_TITLES } = require('./messages');
const { normalizeConfig } = require('./people');

// ------------------------------------------------------------
// CONSTANTS & SETTINGS
// ------------------------------------------------------------
const HISTORY_FILE = './history.json';
const STATE_FILE = './state.json';
const TICK_SECONDS = 20;

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set in .env — create a bot with @BotFather to get one.');
    process.exit(1);
}
const tg = createTelegram(TOKEN);

// Language for chats that aren't configured people (e.g. someone new
// pressing Start). Each person can have their own language in pills.json.
let defaultT;
try {
    defaultT = getMessages(process.env.BOT_LANGUAGE);
} catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
}

// ------------------------------------------------------------
// LOAD PEOPLE & PILLS (see people.js for the pills.json format)
// ------------------------------------------------------------
function loadConfig() {
    try {
        const raw = JSON.parse(fs.readFileSync('./pills.json', 'utf8'));
        const config = normalizeConfig(raw, process.env);
        for (const person of config.people) {
            person.t = getMessages(person.language);
            console.log(`💊 ${person.name}: ${person.pills.length} pill(s), language ${person.language}` +
                (person.caregivers.length ? `, caregivers: ${person.caregivers.join(', ')}` : ''));
        }
        return config;
    } catch (err) {
        console.error('❌ Failed to load pills.json:', err.message);
        process.exit(1);
    }
}

const config = loadConfig();
const people = config.people;
const owner = people[0] || null;                   // first person in pills.json
const personByChat = new Map(people.map(p => [p.chatId, p]));
const personByName = new Map(people.map(p => [p.name, p]));

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
    console.log(`📝 Logged: ${entry.response.toUpperCase()} for ${entry.person}: ${entry.pillName}`);
}

// ------------------------------------------------------------
// STATE — saved to state.json so a restart doesn't lose anything
//
// Keys are "<chatId>|<pill name>", so each person's pills are separate.
//   pending:     Map<key, { firstSentAt, lastSentAt, remindersSent,
//                           messageIds: number[], caregiverAlerted }>
//   lastFiredAt: Map<key, Date>  (when that pill was last reminded/handled)
// ------------------------------------------------------------
const { pending, lastFiredAt } = loadState(STATE_FILE);

const keyOf = (person, pillName) => `${person.chatId}|${pillName}`;
function splitKey(key) {
    const i = key.indexOf('|');
    return { chatId: key.slice(0, i), pillName: key.slice(i + 1) };
}

function persist() {
    try {
        saveState(STATE_FILE, { pending, lastFiredAt });
    } catch (err) {
        console.error('⚠️  Could not save state.json:', err.message);
    }
}

// Older state.json files used just the pill name as key: they belonged to
// the single (owner) chat.
for (const map of [pending, lastFiredAt]) {
    for (const [key, value] of [...map]) {
        if (key.includes('|')) continue;
        map.delete(key);
        if (owner) map.set(keyOf(owner, key), value);
    }
}

// Drop state for people/pills that were removed from pills.json
for (const map of [pending, lastFiredAt]) {
    for (const key of [...map.keys()]) {
        const { chatId, pillName } = splitKey(key);
        const person = personByChat.get(chatId);
        if (!person || !person.pills.some(p => p.name === pillName)) {
            if (map === pending) console.log(`🗑️  "${pillName}" is no longer in pills.json, dropping its pending reminder`);
            map.delete(key);
        }
    }
}
persist();

if (pending.size > 0) {
    console.log(`⏳ Restored ${pending.size} pending reminder(s) from ${STATE_FILE}`);
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

// Messages use Telegram's HTML formatting, so escape anything from pills.json
function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// " (100mg)" — or nothing when pills.json has no dosage for this pill
function doseSuffix(pill) {
    const dosage = String(pill.dosage ?? '').trim();
    return dosage ? ` (${esc(dosage)})` : '';
}

// This person's pending pill names, oldest reminder first (numbered lists)
function pendingNames(person) {
    const prefix = `${person.chatId}|`;
    return [...pending]
        .filter(([key]) => key.startsWith(prefix))
        .sort((a, b) => a[1].firstSentAt - b[1].firstSentAt)
        .map(([key]) => splitKey(key).pillName);
}

function numberedList(names) {
    return names.map((name, i) => `${i + 1}. ${esc(name)}`).join('\n');
}

// Which of this person's pending pills a reminder message belongs to
function pillForMessageId(person, messageId) {
    for (const name of pendingNames(person)) {
        if (pending.get(keyOf(person, name)).messageIds.includes(messageId)) return name;
    }
    return null;
}

// Button data is "y:<pill name>" (taken) or "n:<pill name>" (skipped);
// whose pill it is comes from the chat the button was pressed in.
function answerButtons(person, pillName) {
    return [[
        { text: person.t.taken, callback_data: `y:${pillName}` },
        { text: person.t.skip, callback_data: `n:${pillName}` }
    ]];
}

// Send a message to a chat. Returns the sent message (with message_id).
function sendTo(chatId, text, buttons) {
    return tg.call('sendMessage', {
        chat_id: chatId,
        text: text.trimEnd(),
        parse_mode: 'HTML',
        ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {})
    });
}

// Remove the buttons from a message (best effort — it may be too old to edit)
function removeButtons(chatId, messageId) {
    return tg.call('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
    }).catch(() => {});
}

// Tell this person's caregivers something (each in their own language).
// `build` gets the caregiver's messages and returns the text.
async function notifyCaregivers(person, build) {
    for (const name of person.caregivers) {
        const caregiver = personByName.get(name);
        try {
            await sendTo(caregiver.chatId, build(caregiver.t));
        } catch (err) {
            console.error(`❌ Failed to notify caregiver ${name}:`, err.message);
        }
    }
}

// ------------------------------------------------------------
// ANSWERING — shared by buttons and typed YES/NO
// ------------------------------------------------------------
async function answerPills(person, pillNames, response) {
    const t = person.t;
    for (const pillName of pillNames) {
        const key = keyOf(person, pillName);
        const info = pending.get(key);
        if (!info) continue;
        pending.delete(key);

        logResponse({
            timestamp: new Date().toISOString(),
            person: person.name,
            pillName,
            response,
            remindersSent: info.remindersSent,
            originalReminderAt: info.firstSentAt.toISOString()
        });

        // Old reminders for this dose shouldn't stay clickable
        await Promise.all(info.messageIds.map(id => removeButtons(person.chatId, id)));

        // A caregiver who was alerted should hear how it ended
        if (info.caregiverAlerted) {
            await notifyCaregivers(person, ct => response === 'yes'
                ? ct.caregiverResolvedTaken(esc(person.name), esc(pillName))
                : ct.caregiverResolvedSkipped(esc(person.name), esc(pillName)));
        }
    }
    persist();
    const remaining = pendingNames(person);
    console.log(`   ✅ Cleared ${person.name}: ${pillNames.join(', ')} (${remaining.length} still pending for them)`);

    const pillList = pillNames.map(n => `<b>${esc(n)}</b>`).join(', ');
    let ack = response === 'yes' ? t.ackTaken(pillList) : t.ackSkipped(pillList);
    if (remaining.length > 0) {
        ack += `\n\n${t.stillWaiting}\n${numberedList(remaining)}`;
    }
    await sendTo(person.chatId, ack);
}

// ------------------------------------------------------------
// MAIN TICK — runs every 20s.
// Handles initial reminders, nags and caregiver alerts.
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
    for (const person of people) {
        const t = person.t;
        for (const pill of person.pills) {
            const key = keyOf(person, pill.name);
            const previous = lastFiredAt.get(key);
            const { action, dueAt } = reminderAction(pill, now, previous, windowMinutes);
            if (action === 'none') continue;

            if (action === 'start_next') {
                // New pill (or first run) and today's time already passed:
                // don't surprise anyone with an old reminder, start next time.
                lastFiredAt.set(key, now);
                persist();
                console.log(`📅 ${person.name}: "${pill.name}" was due at ${pill.time}, before the bot knew about it — first reminder next time`);
                continue;
            }

            let text;
            let buttons = null;
            const name = esc(pill.name);
            const dosage = doseSuffix(pill);
            if (action === 'missed') {
                text = t.missed(pill.time, name, dosage, windowMinutes);
            } else {
                const late = action === 'send_late';
                text =
                    `<b>${t.reminderTitle}</b>${late ? t.late : ''}\n\n` +
                    (late ? t.dueLate(pill.time, name, dosage) : t.dueNow(pill.time, name, dosage)) + '\n' +
                    (pill.notes ? `📝 <i>${esc(pill.notes)}</i>\n` : '');
                buttons = answerButtons(person, pill.name);
            }

            // Mark as handled BEFORE sending, so a slow send can't let the next
            // tick send it again. Undone below if the send fails, to retry.
            lastFiredAt.set(key, now);

            try {
                const sent = await sendTo(person.chatId, text, buttons);
                const sentAt = new Date();
                const lateBy = Math.round((sentAt - dueAt) / 60000);

                if (action === 'missed') {
                    console.log(`⚠️  Missed ${person.name}: ${pill.name} (due ${pill.time}, ${lateBy} min ago) — told them, not asking`);
                    persist();
                    continue;
                }

                console.log(`⏰ [${sentAt.toLocaleTimeString()}] Sent reminder to ${person.name}: ${pill.name}` +
                    (action === 'send_late' ? ` (late by ${lateBy} min)` : ''));

                // If yesterday's dose was never answered, retire its buttons
                const stale = pending.get(key);
                if (stale) await Promise.all(stale.messageIds.map(id => removeButtons(person.chatId, id)));

                pending.set(key, {
                    firstSentAt: sentAt,
                    lastSentAt: sentAt,
                    remindersSent: 1,
                    messageIds: [sent.message_id],
                    caregiverAlerted: false
                });
                persist();
            } catch (err) {
                if (previous) lastFiredAt.set(key, previous);
                else lastFiredAt.delete(key);
                console.error(`❌ Failed to send reminder to ${person.name}: ${pill.name}:`, err.message);
            }
        }
    }

    // ---- 2. Nag pending reminders whose interval has elapsed ----
    for (const [key, info] of pending) {
        const minsAgo = (new Date() - info.lastSentAt) / 60000;
        if (minsAgo < config.reminderIntervalMinutes) continue;

        const { chatId, pillName } = splitKey(key);
        const person = personByChat.get(chatId);
        const t = person.t;

        // ---- 2a. Still unanswered after N reminders → tell the caregivers ----
        if (!info.caregiverAlerted && person.caregivers.length > 0 &&
            info.remindersSent >= config.caregiverAlertAfterReminders) {
            const pill = person.pills.find(p => p.name === pillName);
            await notifyCaregivers(person, ct =>
                ct.caregiverAlert(esc(person.name), esc(pillName), pill.time, info.remindersSent));
            info.caregiverAlerted = true;
            persist();
            console.log(`🚨 Alerted ${person.caregivers.join(', ')}: ${person.name} hasn't answered ${pillName} after ${info.remindersSent} reminders`);
        }

        const nagText = `<b>${t.nagTitle}</b>\n\n` + t.nag(esc(pillName), info.remindersSent + 1);

        try {
            const sent = await sendTo(chatId, nagText, answerButtons(person, pillName));
            console.log(`🔁 Nag #${info.remindersSent + 1} sent to ${person.name}: ${pillName} (${minsAgo.toFixed(1)} min since last)`);
            info.lastSentAt = new Date();
            info.remindersSent += 1;
            info.messageIds.push(sent.message_id);
            persist();
        } catch (err) {
            console.error(`❌ Failed to send nag to ${person.name}: ${pillName}:`, err.message);
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

    const chatId = query.message ? String(query.message.chat.id) : '';
    const person = personByChat.get(chatId);
    if (!person) {
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

    console.log(`🔘 ${person.name} pressed ${response.toUpperCase()} for ${pillName}`);

    if (!pending.has(keyOf(person, pillName))) {
        await done(person.t.toastAlreadyAnswered);
        await removeButtons(chatId, query.message.message_id);
        return;
    }

    await done(response === 'yes' ? person.t.toastTaken(pillName) : person.t.toastSkipped(pillName));
    await removeButtons(chatId, query.message.message_id);  // e.g. the "which one?" question
    await answerPills(person, [pillName], response);
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

// Chats we've already told the owner about (once per run is enough)
const announcedChats = new Set();

async function handleMessage(message) {
    if (!message.text || (message.from && message.from.is_bot)) return;
    const chatId = String(message.chat.id);
    const firstWord = message.text.trim().split(/[\s@]/)[0].toLowerCase();
    const command = COMMAND_ALIASES[firstWord];   // 'help' | 'status' | undefined
    const person = personByChat.get(chatId);

    // ---- Someone who isn't in pills.json ----
    if (!person) {
        if (firstWord !== '/start') {
            console.log('↪️  Ignored a message from a chat that is not in pills.json');
            return;
        }
        const who = [message.from && message.from.first_name, message.from && message.from.last_name]
            .filter(Boolean).join(' ') || 'Someone';
        console.log(`🆔 /start from ${who}, chat ID ${chatId} — add them to pills.json to send them reminders`);

        if (!owner) {
            // First-time setup: nobody configured yet → this is probably you
            await tg.call('sendMessage', { chat_id: chatId, text: defaultT.setup(chatId) });
            return;
        }
        await tg.call('sendMessage', { chat_id: chatId, text: defaultT.setupGuest(chatId) });
        if (!announcedChats.has(chatId)) {
            announcedChats.add(chatId);
            await sendTo(owner.chatId, owner.t.newPerson(esc(who), chatId))
                .catch(err => console.error('⚠️  Could not tell the owner about the new chat:', err.message));
        }
        return;
    }

    const t = person.t;

    if (command === 'help') {
        await sendTo(chatId, t.help);
        return;
    }
    if (command === 'status') {
        const waiting = pendingNames(person);
        const schedule = [...person.pills]
            .sort((a, b) => a.time.localeCompare(b.time))
            .map(p => `• ${p.time} — <b>${esc(p.name)}</b>${doseSuffix(p)}` +
                (waiting.includes(p.name) ? t.statusWaitingTag : ''))
            .join('\n');
        await sendTo(chatId, `${t.statusTitle}\n${schedule}\n\n` +
            (waiting.length > 0 ? `${t.statusWaiting}\n${numberedList(waiting)}` : t.statusNothingWaiting));
        return;
    }

    const parsed = parseReply(message.text);
    if (!parsed) return;  // not a YES/NO — ignore

    const names = pendingNames(person);

    // "y mañana compro leche" with nothing pending is just a note, not a reply
    if (parsed.target && names.length === 0) return;

    console.log(`💬 ${person.name} replied "${message.text}" → ${parsed.response.toUpperCase()}` +
        (parsed.target ? ` for "${parsed.target}"` : ''));

    // If they replied to a reminder, use the pill it was for.
    // Replying to any other message is ignored.
    let quote = null;
    const replied = message.reply_to_message;
    if (replied) {
        const pillName = pillForMessageId(person, replied.message_id);
        const isReminder = REMINDER_TITLES.some(title => (replied.text || '').startsWith(title));
        if (pillName || isReminder) quote = { pillName };
        console.log(pillName
            ? `   ↩️  Reply to the reminder for ${pillName}`
            : `   ↩️  Reply to a message that isn't a waiting reminder`);
    }

    const result = resolveTargets(parsed.target, names, quote);
    const word = parsed.response === 'yes' ? t.yesWord : t.noWord;

    if (result.status === 'none_pending') {
        await sendTo(chatId, t.noneWaiting);
        return;
    }
    if (result.status === 'stale_quote') {
        await sendTo(chatId, `${t.staleReply}\n\n${t.stillWaiting}\n${numberedList(names)}`);
        return;
    }
    if (result.status === 'ambiguous' || result.status === 'not_found') {
        const intro =
            result.status === 'not_found' ? t.notFound(esc(parsed.target)) :
            parsed.target ? t.ambiguousMatch(esc(parsed.target)) :
            t.ambiguous;
        // One button per waiting pill, carrying the YES/NO they typed
        const code = parsed.response === 'yes' ? 'y' : 'n';
        const emoji = parsed.response === 'yes' ? '✅' : '⏭️';
        await sendTo(chatId, `${intro}\n\n${t.pickOne(word)}`,
            names.map(name => [{ text: `${emoji} ${name}`, callback_data: `${code}:${name}` }]));
        return;
    }

    await answerPills(person, result.pills, parsed.response);
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
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log(`🕒 Timezone: ${zone}${TIMEZONE ? '' : ' (system default — set TIMEZONE in .env on a server)'}` +
        ` — local time now ${new Date().toTimeString().slice(0, 5)}`);
    console.log('   Press Ctrl+C to stop the bot.');

    // The "/" menu: default language for everyone, then each person's own
    await tg.call('setMyCommands', { commands: defaultT.commands })
        .catch(err => console.error('⚠️  Could not set bot commands:', err.message));
    for (const person of people) {
        await tg.call('setMyCommands', {
            commands: person.t.commands,
            scope: { type: 'chat', chat_id: person.chatId }
        }).catch(err => console.error(`⚠️  Could not set commands for ${person.name}:`, err.message));
    }

    if (!owner) {
        console.log('');
        console.log('🔧 Setup mode: nobody is configured yet (set TELEGRAM_CHAT_ID in .env, or "people" in pills.json).');
        console.log(`   Open https://t.me/${me.username} in Telegram and press Start.`);
        console.log('   The bot will reply with your chat ID.');
        await pollForever();
        return;
    }

    // Startup message for the owner: their pills, what's waiting, and who
    // else the bot is reminding
    const t = owner.t;
    const pillList = owner.pills
        .map(p => `  • ${p.time} — ${esc(p.name)}${doseSuffix(p)}`)
        .join('\n');
    let message = t.online(owner.pills.length, pillList, config.reminderIntervalMinutes);
    const waiting = pendingNames(owner);
    if (waiting.length > 0) {
        message += `\n\n${t.onlineWaiting}\n${numberedList(waiting)}`;
    }
    if (people.length > 1) {
        message += `\n\n` + t.onlineOthers(people.slice(1)
            .map(p => `  • ${esc(p.name)} (${p.pills.length})`).join('\n'));
    }

    try {
        await sendTo(owner.chatId, message);
        console.log(`📤 Sent startup message to ${owner.name}`);
    } catch (err) {
        console.error('❌ Failed to send startup message:', err.message);
        console.error('   Is the chat ID right, and did they press Start in the bot chat?');
    }

    for (const person of people) {
        for (const p of person.pills) {
            console.log(`📅 ${person.name}: "${p.name}" daily at ${p.time}`);
        }
    }
    console.log(`🔁 Checking every ${TICK_SECONDS}s (nag interval: ${config.reminderIntervalMinutes} min, ` +
        `caregiver alert after ${config.caregiverAlertAfterReminders} reminders)`);

    // First tick right away, so reminders missed while offline go out now.
    tick();
    setInterval(tick, TICK_SECONDS * 1000);

    await pollForever();
}

main();
