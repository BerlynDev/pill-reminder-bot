// ============================================================
// PILL REMINDER BOT
// ============================================================

// Load environment variables from .env into process.env
require('dotenv').config();

const fs = require('fs');                              // built-in: read/write files
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { loadState, saveState } = require('./state');
const { parseReply, resolveTargets } = require('./replies');

// NOTE: every message the bot sends must NOT start with a YES/NO word or
// emoji (see replies.js), otherwise the bot would read its own messages
// as replies.

// ------------------------------------------------------------
// CONSTANTS
// ------------------------------------------------------------
const HISTORY_FILE = './history.json';
const STATE_FILE = './state.json';

// ------------------------------------------------------------
// LOAD PILL CONFIG
// ------------------------------------------------------------
function loadPills() {
    try {
        const fileContents = fs.readFileSync('./pills.json', 'utf8');
        const config = JSON.parse(fileContents);
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

// Pills currently waiting for a YES/NO reply.
// Map<pillName, { firstSentAt: Date, lastSentAt: Date,
//                 remindersSent: number, messageIds: string[] }>
// When each pill was last fired — prevents double-firing within same minute.
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

// Pending pill names, oldest reminder first (used for numbered lists)
function pendingNames() {
    return [...pendingReminders]
        .sort((a, b) => a[1].firstSentAt - b[1].firstSentAt)
        .map(([name]) => name);
}

// Which pending pill a reminder/nag message belongs to (null if none)
function pillForMessageId(messageId) {
    for (const [name, info] of pendingReminders) {
        if (info.messageIds.includes(messageId)) return name;
    }
    return null;
}

function numberedList(names) {
    return names.map((name, i) => `${i + 1}. ${name}`).join('\n');
}

// How to answer a reminder — explains how to pick a pill when
// more than one is waiting.
function replyInstructions(pillName) {
    const othersWaiting = [...pendingReminders.keys()].some(n => n !== pillName);
    return othersWaiting
        ? `Other pills are waiting too, so reply to *this message* with *YES* or *NO*, ` +
          `or write *YES ${pillName}* / *NO ${pillName}*.`
        : `Reply *YES* when you've taken it, or *NO* to skip.`;
}

// ------------------------------------------------------------
// WHO COUNTS AS "YOU" — only YES/NO from you, in the bot↔you chat
// ------------------------------------------------------------
// Two setups are supported, picked automatically on startup:
//   • Same number  — the bot runs on your own WhatsApp and writes to your
//                    "Message yourself" chat. Replies are messages YOU send there.
//   • Bot number   — the bot runs on a second WhatsApp account and writes to
//                    MY_WHATSAPP_NUMBER. Replies are messages FROM that number.
let sameNumberMode = true;

// IDs WhatsApp uses for your chat with the bot. Seeded on startup with
// MY_WHATSAPP_NUMBER; every message the bot sends you also adds the chat ID
// WhatsApp actually used. Newer accounts can show up as a hidden "@lid" ID
// instead of number@c.us; those are resolved back to the phone number.
const userChatIds = new Set();

async function sendToUser(client, myNumber, text) {
    const sent = await client.sendMessage(myNumber, text);
    if (sent && sent.to) userChatIds.add(sent.to);
    return sent;
}

async function isUserChat(client, chatId) {
    if (userChatIds.has(chatId)) return true;
    if (!chatId || !chatId.endsWith('@lid')) return false;
    try {
        const [ids] = await client.getContactLidAndPhone([chatId]);
        if (ids && ids.pn && userChatIds.has(ids.pn)) {
            userChatIds.add(chatId);  // remember, so we only look it up once
            return true;
        }
    } catch (err) {
        console.error('⚠️  Could not resolve @lid chat ID:', err.message);
    }
    return false;
}

// Is this message a reply written by you, in your chat with the bot?
async function isFromUser(client, msg) {
    if (sameNumberMode) {
        // You write in your own self-chat; msg.to is the chat it was sent to
        return msg.fromMe && isUserChat(client, msg.to);
    }
    // Messages the bot account sends itself are never replies
    return !msg.fromMe && isUserChat(client, msg.from);
}

// "593000001234@c.us" → "…1234@c.us" — never print full phone numbers
function maskId(id) {
    return String(id).replace(/^\d+(?=\d{4}@)/, '…');
}

// ------------------------------------------------------------
// MAIN TICK — runs every 20s via setInterval.
// Handles initial reminders AND nags in one place.
// ------------------------------------------------------------
async function tick(client, myNumber, config) {
    const now = new Date();

    // "HH:MM" for the current moment (e.g. "15:38")
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;

    // ---- 1. Fire initial reminders for any pill matching the current minute ----
    for (const pill of config.pills) {
        if (pill.time !== currentTime) continue;

        // Don't double-fire within the same minute
        const last = lastFiredAt.get(pill.name);
        if (last && (now - last) < 2 * 60 * 1000) continue;

        const reminderText =
            `💊 *Pill Reminder*\n\n` +
            `It's ${pill.time} — time to take your *${pill.name}* (${pill.dosage}).\n` +
            (pill.notes ? `📝 _${pill.notes}_\n\n` : `\n`) +
            replyInstructions(pill.name);

        try {
            const sent = await sendToUser(client, myNumber, reminderText);
            const sentAt = new Date();
            console.log(`⏰ [${sentAt.toLocaleTimeString()}] Sent reminder for ${pill.name}`);
            pendingReminders.set(pill.name, {
                firstSentAt: sentAt,
                lastSentAt: sentAt,
                remindersSent: 1,
                messageIds: [sent.id.id]
            });
            lastFiredAt.set(pill.name, sentAt);
            persist();
        } catch (err) {
            console.error(`❌ Failed to send reminder for ${pill.name}:`, err.message);
        }
    }

    // ---- 2. Nag any pending reminders whose interval has elapsed ----
    for (const [pillName, info] of pendingReminders) {
        const minsAgo = (new Date() - info.lastSentAt) / 60000;
        if (minsAgo < config.reminderIntervalMinutes) continue;

        const nagText =
            `🔁 *Still waiting on you!*\n\n` +
            `Did you take your *${pillName}* yet?\n` +
            `(This is reminder #${info.remindersSent + 1})\n\n` +
            replyInstructions(pillName);

        try {
            const sent = await sendToUser(client, myNumber, nagText);
            console.log(`🔁 Nag #${info.remindersSent + 1} sent for ${pillName} (${minsAgo.toFixed(1)} min since last)`);
            info.lastSentAt = new Date();
            info.remindersSent += 1;
            info.messageIds.push(sent.id.id);
            persist();
        } catch (err) {
            console.error(`❌ Failed to send nag for ${pillName}:`, err.message);
        }
    }
}

// ------------------------------------------------------------
// CREATE WHATSAPP CLIENT
// ------------------------------------------------------------
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ------------------------------------------------------------
// EVENT: QR code (first run only)
// ------------------------------------------------------------
client.on('qr', (qr) => {
    console.log('📱 Scan this QR code with WhatsApp on your phone:');
    qrcode.generate(qr, { small: true });
});

// ------------------------------------------------------------
// EVENT: Ready — login complete, start the tick loop
// ------------------------------------------------------------
client.on('ready', async () => {
    console.log('');
    console.log('✅ WhatsApp is ready! The bot is now connected.');
    console.log('   Press Ctrl+C to stop the bot.');

    const myNumber = process.env.MY_WHATSAPP_NUMBER;
    if (!myNumber) {
        console.error('❌ MY_WHATSAPP_NUMBER is not set in .env');
        return;
    }

    userChatIds.add(myNumber);
    const botUser = client.info && client.info.wid && client.info.wid.user;
    sameNumberMode = !botUser || botUser === myNumber.split('@')[0];
    console.log(sameNumberMode
        ? `📲 Same-number mode: reminders go to your "Message yourself" chat`
        : `📲 Bot-number mode: bot account ${maskId(client.info.wid._serialized)} → reminders go to ${maskId(myNumber)}`);

    // Startup message listing loaded pills (and anything still unanswered)
    const pillList = config.pills
        .map(p => `  • ${p.time} — ${p.name} (${p.dosage})`)
        .join('\n');
    let message =
        `👋 Pill reminder bot is online!\n\n` +
        `Loaded ${config.pills.length} pill(s):\n${pillList}\n\n` +
        `I'll remind you every ${config.reminderIntervalMinutes} min ` +
        `until you reply YES.`;
    if (pendingReminders.size > 0) {
        message += `\n\n⏳ Still waiting on a reply for:\n${numberedList(pendingNames())}`;
    }

    try {
        await sendToUser(client, myNumber, message);
        console.log('📤 Sent startup message');
    } catch (err) {
        console.error('❌ Failed to send startup message:', err.message);
    }

    // Log schedule
    config.pills.forEach(p => {
        console.log(`📅 Will remind for "${p.name}" daily at ${p.time}`);
    });
    console.log(`🔁 Tick loop running every 20s (nag interval: ${config.reminderIntervalMinutes} min)`);

    // Start the unified tick loop — handles initial reminders AND nags.
    // Runs every 20 seconds; the function decides when to actually send.
    setInterval(() => tick(client, myNumber, config), 20 * 1000);
});

// ------------------------------------------------------------
// EVENT: incoming message — handle YES / NO replies
//
// Supported replies:
//   YES / NO                 → the only waiting pill
//   YES / NO quoting a reminder → the pill that reminder was for
//   YES Aspirin / NO vit     → pill by (partial) name
//   YES 2                    → pill #2 in the "which one?" list
//   YES ALL                  → every waiting pill
// ------------------------------------------------------------
client.on('message_create', async (msg) => {
    const parsed = parseReply(msg.body);
    if (!parsed) return;  // not a YES/NO — ignore

    // A "yes" in any other chat (a friend, a group, a stranger writing to
    // the bot number) is not a pill reply.
    if (!(await isFromUser(client, msg))) {
        const chat = msg.fromMe ? msg.to : msg.from;
        console.log(`↪️  Ignored a YES/NO in another chat (${maskId(chat)})`);
        return;
    }

    const names = pendingNames();

    // "y mañana compro leche" with nothing pending is just a note, not a reply
    if (parsed.target && names.length === 0) return;

    const myNumber = process.env.MY_WHATSAPP_NUMBER;
    const send = (text) => sendToUser(client, myNumber, text)
        .catch(err => console.error('❌ Failed to send reply:', err.message));

    console.log(`💬 Got reply "${msg.body}" → ${parsed.response.toUpperCase()}` +
        (parsed.target ? ` for "${parsed.target}"` : ''));

    // If you swiped-to-reply on a reminder, use the pill it was for.
    // Quoting any other message is ignored.
    let quote = null;
    if (msg.hasQuotedMsg) {
        try {
            const quoted = await msg.getQuotedMessage();
            const pillName = pillForMessageId(quoted.id.id);
            const isReminder = /^(💊 \*Pill Reminder\*|🔁 \*Still waiting on you!\*)/.test(quoted.body);
            if (pillName || isReminder) quote = { pillName };
        } catch (err) {
            console.error('⚠️  Could not read quoted message:', err.message);
        }
    }

    const result = resolveTargets(parsed.target, names, quote);
    const word = parsed.response.toUpperCase();

    if (result.status === 'none_pending') {
        await send(`🤔 No pill reminders are waiting for a reply right now.`);
        return;
    }
    if (result.status === 'stale_quote') {
        await send(`🤔 That reminder isn't waiting for a reply anymore.\n\n` +
            `Still waiting on:\n${numberedList(names)}`);
        return;
    }
    if (result.status === 'ambiguous' || result.status === 'not_found') {
        const intro =
            result.status === 'not_found' ? `❓ I couldn't find a waiting pill called "${parsed.target}".` :
            parsed.target ? `❓ More than one waiting pill matches "${parsed.target}". Which one?` :
            `❓ More than one pill is waiting. Which one is this for?`;
        await send(`${intro}\n\n${numberedList(names)}\n\n` +
            `Reply e.g. *${word} ${names[0]}*, *${word} 1* or *${word} ALL*. ` +
            `You can also reply directly to the reminder message.`);
        return;
    }

    // ---- status === 'ok' ----
    for (const pillName of result.pills) {
        const info = pendingReminders.get(pillName);
        pendingReminders.delete(pillName);

        logResponse({
            timestamp: new Date().toISOString(),
            pillName,
            response: parsed.response,
            remindersSent: info.remindersSent,
            originalReminderAt: info.firstSentAt.toISOString()
        });
    }
    persist();
    console.log(`   ✅ Cleared ${result.pills.join(', ')} from pending (${pendingReminders.size} remaining)`);

    const pillList = result.pills.map(n => `*${n}*`).join(', ');
    let ack = parsed.response === 'yes'
        ? `🎉 Great! Logged that you took your ${pillList}. Stay healthy! 💪`
        : `⏭️ Noted — you skipped ${pillList}. I won't keep reminding you.`;
    if (pendingReminders.size > 0) {
        ack += `\n\nStill waiting on:\n${numberedList(pendingNames())}`;
    }
    await send(ack);
});

// ------------------------------------------------------------
// EVENT: Auth failure
// ------------------------------------------------------------
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
});

// ------------------------------------------------------------
// EVENT: Disconnected
// ------------------------------------------------------------
client.on('disconnected', (reason) => {
    console.log('⚠️  Disconnected:', reason);
});

// ------------------------------------------------------------
// START THE BOT
// ------------------------------------------------------------
console.log('🚀 Starting the pill reminder bot...');
client.initialize();
