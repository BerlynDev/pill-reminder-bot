// ============================================================
// MESSAGES — everything the bot says in Telegram, per language
// ============================================================
//
// Pick the language with BOT_LANGUAGE in .env ("es" or "en"); default "es".
// Text uses Telegram HTML: wrap values from pills.json in esc() first —
// callers pass names/dosages/notes already escaped.
//
// To add a language, copy the `en` block and translate every entry.

const en = {
    // Reminders
    reminderTitle: '💊 Pill Reminder',          // plain text, also used to recognise replies
    nagTitle: '🔁 Still waiting on you!',       // plain text, also used to recognise replies
    late: ' (late)',
    dueNow: (time, name, dosage) => `It's ${time} — time to take your <b>${name}</b> (${dosage}).`,
    dueLate: (time, name, dosage) =>
        `This was due at ${time} — time to take your <b>${name}</b> (${dosage}).\n` +
        `<i>I was offline or asleep at ${time}, so this reminder is late.</i>`,
    missed: (time, name, dosage, windowMinutes) =>
        `⚠️ <b>Missed reminder</b>\n\n` +
        `I was offline at ${time}, when your <b>${name}</b> (${dosage}) was due, ` +
        `and that was more than ${windowMinutes} min ago, so I won't ask about this dose.`,
    nag: (name, number) => `Did you take your <b>${name}</b> yet?\n(This is reminder #${number})`,

    // Buttons and button feedback
    taken: '✅ Taken',
    skip: '⏭️ Skip',
    toastTaken: (name) => `✅ ${name} logged`,
    toastSkipped: (name) => `⏭️ ${name} skipped`,
    toastAlreadyAnswered: 'This dose was already answered.',

    // Answers
    ackTaken: (list) => `🎉 Great! Logged that you took your ${list}. Stay healthy! 💪`,
    ackSkipped: (list) => `⏭️ Noted — you skipped ${list}. I won't keep reminding you.`,
    stillWaiting: 'Still waiting on:',
    noneWaiting: '🤔 No pill reminders are waiting for an answer right now.',
    staleReply: "🤔 That reminder isn't waiting for an answer anymore.",
    notFound: (target) => `❓ I couldn't find a waiting pill called "${target}".`,
    ambiguousMatch: (target) => `❓ More than one waiting pill matches "${target}". Which one?`,
    ambiguous: '❓ More than one pill is waiting. Which one is this for?',
    pickOne: (word) => `Tap one below, or type <b>${word} ALL</b>.`,
    yesWord: 'YES',
    noWord: 'NO',

    // Commands
    help:
        `👋 <b>Pill reminder bot</b>\n\n` +
        `I'll message you at each pill's time. Tap <b>✅ Taken</b> or <b>⏭️ Skip</b> on the reminder, ` +
        `or type <b>YES</b> / <b>NO</b>.\n\n` +
        `If more than one pill is waiting, tap the buttons on the right reminder, ` +
        `or type e.g. <b>YES Aspirin</b>, <b>YES 2</b> or <b>YES ALL</b>.\n\n` +
        `/status — today's schedule and what's waiting`,
    statusTitle: '📋 <b>Your pills</b>',
    statusWaitingTag: ' ⏳ waiting',
    statusWaiting: '⏳ Waiting for an answer:',
    statusNothingWaiting: '✅ Nothing waiting for an answer.',
    commands: [
        { command: 'status', description: "Today's schedule and what's waiting" },
        { command: 'help', description: 'How to answer reminders' }
    ],

    // Startup / setup
    online: (count, list, interval) =>
        `👋 Pill reminder bot is online!\n\n` +
        `Loaded ${count} pill(s):\n${list}\n\n` +
        `I'll remind you every ${interval} min until you answer.`,
    onlineWaiting: '⏳ Still waiting on an answer for:',
    setup: (chatId) =>
        `👋 Almost ready!\n\nYour chat ID is ${chatId}.\n` +
        `Add this line to the bot's .env file and restart it:\n\nTELEGRAM_CHAT_ID=${chatId}`
};

// "la 01:30" but "las 09:00"
const laLas = (time) => (time.startsWith('01:') ? `la ${time}` : `las ${time}`);

const es = {
    // Recordatorios
    reminderTitle: '💊 Recordatorio de pastilla',
    nagTitle: '🔁 ¡Sigo esperando!',
    late: ' (tarde)',
    dueNow: (time, name, dosage) =>
        `${time.startsWith('01:') ? 'Es' : 'Son'} ${laLas(time)} — es hora de tomar tu <b>${name}</b> (${dosage}).`,
    dueLate: (time, name, dosage) =>
        `Tocaba a ${laLas(time)} — es hora de tomar tu <b>${name}</b> (${dosage}).\n` +
        `<i>Estaba desconectado o en reposo a ${laLas(time)}, por eso este recordatorio llega tarde.</i>`,
    missed: (time, name, dosage, windowMinutes) =>
        `⚠️ <b>Recordatorio perdido</b>\n\n` +
        `Estaba desconectado a ${laLas(time)}, cuando tocaba tu <b>${name}</b> (${dosage}), ` +
        `y ya pasaron más de ${windowMinutes} min, así que no preguntaré por esta dosis.`,
    nag: (name, number) => `¿Ya tomaste tu <b>${name}</b>?\n(Recordatorio n.º ${number})`,

    // Botones
    taken: '✅ Tomada',
    skip: '⏭️ Omitir',
    toastTaken: (name) => `✅ ${name} registrada`,
    toastSkipped: (name) => `⏭️ ${name} omitida`,
    toastAlreadyAnswered: 'Esta dosis ya fue respondida.',

    // Respuestas
    ackTaken: (list) => `🎉 ¡Genial! Anoté que tomaste tu ${list}. ¡Cuídate! 💪`,
    ackSkipped: (list) => `⏭️ Entendido — omitiste ${list}. No te lo volveré a recordar.`,
    stillWaiting: 'Aún esperando:',
    noneWaiting: '🤔 No hay recordatorios esperando respuesta ahora mismo.',
    staleReply: '🤔 Ese recordatorio ya no está esperando respuesta.',
    notFound: (target) => `❓ No encontré una pastilla pendiente llamada "${target}".`,
    ambiguousMatch: (target) => `❓ Más de una pastilla pendiente coincide con "${target}". ¿Cuál?`,
    ambiguous: '❓ Hay más de una pastilla pendiente. ¿Para cuál es?',
    pickOne: (word) => `Toca una abajo, o escribe <b>${word} TODAS</b>.`,
    yesWord: 'SÍ',
    noWord: 'NO',

    // Comandos
    help:
        `👋 <b>Bot de recordatorios de pastillas</b>\n\n` +
        `Te escribiré a la hora de cada pastilla. Toca <b>✅ Tomada</b> u <b>⏭️ Omitir</b> en el recordatorio, ` +
        `o escribe <b>SÍ</b> / <b>NO</b>.\n\n` +
        `Si hay más de una pastilla pendiente, toca los botones del recordatorio correcto, ` +
        `o escribe por ejemplo <b>SÍ Aspirina</b>, <b>SÍ 2</b> o <b>SÍ TODAS</b>.\n\n` +
        `/estado — horario de hoy y lo pendiente`,
    statusTitle: '📋 <b>Tus pastillas</b>',
    statusWaitingTag: ' ⏳ pendiente',
    statusWaiting: '⏳ Esperando respuesta:',
    statusNothingWaiting: '✅ No hay nada pendiente.',
    commands: [
        { command: 'estado', description: 'Horario de hoy y lo pendiente' },
        { command: 'ayuda', description: 'Cómo responder a los recordatorios' }
    ],

    // Inicio / configuración
    online: (count, list, interval) =>
        `👋 ¡El bot de recordatorios está en línea!\n\n` +
        `Cargué ${count} pastilla(s):\n${list}\n\n` +
        `Te recordaré cada ${interval} min hasta que respondas.`,
    onlineWaiting: '⏳ Aún esperando respuesta de:',
    setup: (chatId) =>
        `👋 ¡Casi listo!\n\nTu chat ID es ${chatId}.\n` +
        `Agrega esta línea al archivo .env del bot y reinícialo:\n\nTELEGRAM_CHAT_ID=${chatId}`
};

const LANGUAGES = { en, es };
const DEFAULT_LANGUAGE = 'es';

// Commands work in every language (/status or /estado, /help or /ayuda)
const COMMAND_ALIASES = {
    '/start': 'help', '/help': 'help', '/ayuda': 'help',
    '/status': 'status', '/estado': 'status'
};

// Titles in every language, so a reply to an old reminder is still
// recognised after switching languages
const REMINDER_TITLES = Object.values(LANGUAGES).flatMap(l => [l.reminderTitle, l.nagTitle]);

function getMessages(language) {
    const code = String(language || DEFAULT_LANGUAGE).trim().toLowerCase();
    if (!LANGUAGES[code]) {
        throw new Error(`BOT_LANGUAGE "${language}" isn't supported — use one of: ${Object.keys(LANGUAGES).join(', ')}`);
    }
    return LANGUAGES[code];
}

module.exports = { getMessages, COMMAND_ALIASES, REMINDER_TITLES, LANGUAGES };
