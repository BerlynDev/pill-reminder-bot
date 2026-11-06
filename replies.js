// ============================================================
// REPLY PARSING — figure out which pending pill a YES/NO is for
// ============================================================

const YES_WORDS = ['yes', 'y', 'si', '✅', '👍'];
const NO_WORDS = ['no', 'n', '❌', '👎'];
const ALL_WORDS = ['all', 'todas', 'todos'];

// Lowercase, strip accents ("sí" → "si"), emoji skin tones / variation
// selectors, and collapse whitespace so matching is forgiving.
function normalize(text) {
    return text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[\u{1F3FB}-\u{1F3FF}️]/gu, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

// "yes", "Sí, Aspirin", "no 2", "👍 all"  →  { response, target }
// Returns null when the message doesn't start with a YES/NO word.
function parseReply(body) {
    const [first, ...rest] = normalize(body).split(' ');
    const word = first.replace(/[.,!?]+$/, '');

    let response;
    if (YES_WORDS.includes(word)) response = 'yes';
    else if (NO_WORDS.includes(word)) response = 'no';
    else return null;

    return { response, target: rest.join(' ').replace(/[.,!?]+$/, '') };
}

// Decide which pending pill(s) a reply refers to.
//   target       — text after YES/NO ("" if none)
//   pendingNames — names of pills waiting for a reply, in display order
//   quote        — null if the reply doesn't quote a message, otherwise
//                  { pillName } (pillName is null if the quoted message
//                  isn't a reminder that's still waiting)
// Returns { status: 'ok', pills } or { status: 'none_pending' | 'ambiguous'
// | 'not_found' | 'stale_quote', candidates? }.
function resolveTargets(target, pendingNames, quote) {
    if (pendingNames.length === 0) return { status: 'none_pending' };

    if (!target) {
        if (quote) {
            return quote.pillName && pendingNames.includes(quote.pillName)
                ? { status: 'ok', pills: [quote.pillName] }
                : { status: 'stale_quote' };
        }
        if (pendingNames.length === 1) return { status: 'ok', pills: [pendingNames[0]] };
        return { status: 'ambiguous', candidates: pendingNames };
    }

    if (ALL_WORDS.includes(target)) return { status: 'ok', pills: [...pendingNames] };

    if (/^\d+$/.test(target)) {
        const pill = pendingNames[Number(target) - 1];
        return pill ? { status: 'ok', pills: [pill] } : { status: 'not_found' };
    }

    const exact = pendingNames.filter(n => normalize(n) === target);
    if (exact.length === 1) return { status: 'ok', pills: exact };

    const partial = pendingNames.filter(n => normalize(n).includes(target));
    if (partial.length === 1) return { status: 'ok', pills: partial };
    if (partial.length > 1) return { status: 'ambiguous', candidates: partial };

    return { status: 'not_found' };
}

module.exports = { parseReply, resolveTargets };
