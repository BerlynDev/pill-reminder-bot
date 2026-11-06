// ============================================================
// TELEGRAM BOT API — tiny client using Node's built-in fetch
// https://core.telegram.org/bots/api
// ============================================================

function createTelegram(token) {
    const baseUrl = `https://api.telegram.org/bot${token}/`;

    // Never let the token end up in logs or error messages
    const scrub = (text) => String(text).split(token).join('<token>');

    // Call a Bot API method; returns its `result` or throws.
    async function call(method, params = {}) {
        // getUpdates long-polls for up to `timeout` seconds; give it headroom
        const timeoutMs = method === 'getUpdates' ? ((params.timeout || 0) + 15) * 1000 : 15000;

        let response;
        try {
            response = await fetch(baseUrl + method, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch (err) {
            const reason = (err.cause && err.cause.message) || err.message;
            throw new Error(`Telegram ${method}: network error (${scrub(reason)})`);
        }

        const data = await response.json().catch(() => ({}));
        if (!data.ok) {
            const err = new Error(`Telegram ${method}: ${scrub(data.description || `HTTP ${response.status}`)}`);
            err.code = data.error_code;
            throw err;
        }
        return data.result;
    }

    return { call };
}

module.exports = { createTelegram };
