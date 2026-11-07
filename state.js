// ============================================================
// STATE PERSISTENCE — keep pending reminders across restarts
// ============================================================

const fs = require('fs');

function emptyState() {
    return { pending: new Map(), lastFiredAt: new Map() };
}

// Read state.json into Maps with real Date objects.
// Missing or unreadable file → start with an empty state.
function loadState(file) {
    if (!fs.existsSync(file)) return emptyState();

    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

        const pending = new Map(
            Object.entries(raw.pending || {}).map(([name, p]) => [name, {
                firstSentAt: new Date(p.firstSentAt),
                lastSentAt: new Date(p.lastSentAt),
                remindersSent: p.remindersSent,
                messageIds: p.messageIds || [],
                caregiverAlerted: Boolean(p.caregiverAlerted)
            }])
        );
        const lastFiredAt = new Map(
            Object.entries(raw.lastFiredAt || {}).map(([name, t]) => [name, new Date(t)])
        );

        return { pending, lastFiredAt };
    } catch (err) {
        console.error(`⚠️  Could not read ${file}, starting fresh:`, err.message);
        return emptyState();
    }
}

// Write state atomically (temp file + rename) so a crash mid-write
// can't leave a half-written state.json behind.
function saveState(file, { pending, lastFiredAt }) {
    const data = {
        pending: Object.fromEntries(
            [...pending].map(([name, p]) => [name, {
                firstSentAt: p.firstSentAt.toISOString(),
                lastSentAt: p.lastSentAt.toISOString(),
                remindersSent: p.remindersSent,
                messageIds: p.messageIds,
                caregiverAlerted: Boolean(p.caregiverAlerted)
            }])
        ),
        lastFiredAt: Object.fromEntries(
            [...lastFiredAt].map(([name, t]) => [name, t.toISOString()])
        )
    };

    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
}

module.exports = { loadState, saveState };
