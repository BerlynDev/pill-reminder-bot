// ============================================================
// TELEGRAM BOT API — tiny client using Node's built-in fetch
// https://core.telegram.org/bots/api
// ============================================================

function createTelegram(token) {
    const baseUrl = `https://api.telegram.org/bot${token}/`;

    // Never let the token end up in logs or error messages
    const scrub = (text) => String(text).split(token).join('<token>');

    // Call a Bot API method; returns its `result` or throws.
    // Network blips (timeouts, dropped connections) and "too many requests"
    // are retried a couple of times; real API errors (bad token, bad
    // request) are not. getUpdates isn't retried here — its loop does that.
    async function call(method, params = {}) {
        const maxRetries = method === 'getUpdates' ? 0 : 3;
        for (let attempt = 0; ; attempt++) {
            try {
                return await callOnce(method, params);
            } catch (err) {
                const retryable = err.network || err.code === 429;
                if (!retryable || attempt >= maxRetries) throw err;
                const waitSeconds = err.retryAfter || 2 ** attempt;   // 1s, 2s, 4s
                console.log(`   ↻ ${err.message} — retrying in ${waitSeconds}s`);
                await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
            }
        }
    }

    async function callOnce(method, params) {
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
            const networkErr = new Error(`Telegram ${method}: network error (${scrub(reason)})`);
            networkErr.network = true;
            throw networkErr;
        }

        let data;
        try {
            data = await response.json();
        } catch (err) {
            // Connection dropped mid-response, or a proxy returned non-JSON
            const networkErr = new Error(`Telegram ${method}: bad response (HTTP ${response.status})`);
            networkErr.network = true;
            throw networkErr;
        }
        if (!data.ok) {
            const err = new Error(`Telegram ${method}: ${scrub(data.description || `HTTP ${response.status}`)}`);
            err.code = data.error_code;
            err.retryAfter = data.parameters && data.parameters.retry_after;
            throw err;
        }
        return data.result;
    }

    return { call };
}

module.exports = { createTelegram };
