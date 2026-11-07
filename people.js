// ============================================================
// PEOPLE — who gets which pills (reads and checks pills.json)
// ============================================================
//
// Multi-person format:
//   {
//     "people": [
//       { "name": "Yo",   "chatId": "111", "language": "es", "pills": [ ... ] },
//       { "name": "Mamá", "chatId": "222", "caregivers": ["Yo"], "pills": [ ... ] }
//     ],
//     "reminderIntervalMinutes": 5,
//     "caregiverAlertAfterReminders": 3
//   }
//
// The old single-person format ({ "pills": [...] } + TELEGRAM_CHAT_ID in
// .env) still works: it becomes one person called "owner".
//
// The FIRST person is the owner: gets the startup message and is told when
// someone new presses Start.

const { LANGUAGES } = require('./messages');

const DEFAULT_CAREGIVER_ALERT_AFTER = 3;

function fail(message) {
    throw new Error(message);
}

function checkPills(pills, who) {
    if (!Array.isArray(pills)) fail(`${who}: "pills" must be a list`);
    const names = new Set();
    for (const pill of pills) {
        if (!pill || typeof pill.name !== 'string' || !pill.name.trim()) fail(`${who}: every pill needs a "name"`);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pill.time)) {
            fail(`${who}: "${pill.name}" has time "${pill.time}" — use 24-hour HH:MM, e.g. "08:00" or "21:30"`);
        }
        // The name travels inside button data, which Telegram caps at 64 bytes
        if (Buffer.byteLength(pill.name, 'utf8') > 60) fail(`${who}: "${pill.name}" is too long — keep pill names under ~60 characters`);
        if (names.has(pill.name)) fail(`${who}: "${pill.name}" appears twice — pill names must be unique per person`);
        names.add(pill.name);
    }
}

// raw: parsed pills.json. env: { TELEGRAM_CHAT_ID, BOT_LANGUAGE }.
// Returns { people, reminderIntervalMinutes, missedReminderWindowMinutes,
// caregiverAlertAfterReminders }. Throws with a clear message if invalid.
function normalizeConfig(raw, env = {}) {
    if (!raw || typeof raw !== 'object') fail('pills.json must contain a JSON object');
    const defaultLanguage = String(env.BOT_LANGUAGE || 'es').trim().toLowerCase() || 'es';

    let rawPeople;
    if (Array.isArray(raw.people)) {
        rawPeople = raw.people;
    } else if (Array.isArray(raw.pills)) {
        // Old format: everything belongs to TELEGRAM_CHAT_ID (if set yet)
        const chatId = String(env.TELEGRAM_CHAT_ID || '').trim();
        rawPeople = chatId ? [{ name: 'owner', chatId, pills: raw.pills }] : [];
        checkPills(raw.pills, 'pills.json');
    } else {
        fail('pills.json needs a "people" list (or the older "pills" list)');
    }

    const people = rawPeople.map((p, i) => {
        const who = `people[${i}]${p && p.name ? ` ("${p.name}")` : ''}`;
        if (!p || typeof p.name !== 'string' || !p.name.trim()) fail(`${who}: needs a "name"`);
        const chatId = String(p.chatId ?? '').trim();
        if (!/^-?\d+$/.test(chatId)) fail(`${who}: "chatId" must be the number the bot gave them on /start`);
        const language = String(p.language || defaultLanguage).trim().toLowerCase();
        if (!LANGUAGES[language]) fail(`${who}: language "${p.language}" isn't supported — use one of: ${Object.keys(LANGUAGES).join(', ')}`);
        checkPills(p.pills, who);
        return {
            name: p.name.trim(),
            chatId,
            language,
            caregivers: Array.isArray(p.caregivers) ? p.caregivers.map(String) : [],
            pills: p.pills
        };
    });

    // Unique names and chat IDs; caregivers must be other configured people
    const byName = new Map();
    const chatIds = new Set();
    for (const person of people) {
        if (byName.has(person.name)) fail(`Two people are called "${person.name}" — names must be unique`);
        if (chatIds.has(person.chatId)) fail(`"${person.name}" has the same chatId as someone else`);
        byName.set(person.name, person);
        chatIds.add(person.chatId);
    }
    for (const person of people) {
        for (const caregiver of person.caregivers) {
            if (caregiver === person.name) fail(`"${person.name}" can't be their own caregiver`);
            if (!byName.has(caregiver)) fail(`"${person.name}" has caregiver "${caregiver}", who isn't in "people"`);
        }
    }

    const alertAfter = raw.caregiverAlertAfterReminders ?? DEFAULT_CAREGIVER_ALERT_AFTER;
    if (!Number.isInteger(alertAfter) || alertAfter < 1) fail('"caregiverAlertAfterReminders" must be a whole number ≥ 1');
    if (!(raw.reminderIntervalMinutes > 0)) fail('"reminderIntervalMinutes" must be a number > 0');

    return {
        people,
        reminderIntervalMinutes: raw.reminderIntervalMinutes,
        missedReminderWindowMinutes: raw.missedReminderWindowMinutes,
        caregiverAlertAfterReminders: alertAfter
    };
}

module.exports = { normalizeConfig, DEFAULT_CAREGIVER_ALERT_AFTER };
