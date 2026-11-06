// ============================================================
// SCHEDULING — decide whether a pill's reminder is due
// ============================================================
//
// Instead of "is it exactly HH:MM right now?", we ask "has the pill's most
// recent scheduled time passed without a reminder?". That way a reminder
// still goes out if the bot was restarted, crashed, or the computer was
// asleep at the scheduled minute.

const DEFAULT_MISSED_WINDOW_MINUTES = 180;

// Most recent scheduled time for "HH:MM" at or before `now`
// (yesterday's, if today's hasn't come yet).
function lastDueAt(time, now) {
    const [hours, minutes] = time.split(':').map(Number);
    const due = new Date(now);
    due.setHours(hours, minutes, 0, 0);
    if (due > now) due.setDate(due.getDate() - 1);
    return due;
}

// What to do about `pill` right now:
//   none       — this dose was already handled
//   send       — it's due (on time)
//   send_late  — it was due a while ago (bot was offline/asleep), still
//                within the window → send it, marked as late
//   missed     — it was due longer ago than the window → just tell the user
//   start_next — pill has never been reminded (new pill, first run) and
//                today's time already passed → start from the next one
//
// lastHandledAt: when this pill was last reminded/handled, or undefined.
function reminderAction(pill, now, lastHandledAt, windowMinutes = DEFAULT_MISSED_WINDOW_MINUTES) {
    const dueAt = lastDueAt(pill.time, now);
    if (lastHandledAt && lastHandledAt >= dueAt) return { action: 'none', dueAt };

    const lateMinutes = (now - dueAt) / 60000;
    if (lateMinutes < 1) return { action: 'send', dueAt };
    if (!lastHandledAt) return { action: 'start_next', dueAt };
    if (lateMinutes <= windowMinutes) return { action: 'send_late', dueAt };
    return { action: 'missed', dueAt };
}

module.exports = { lastDueAt, reminderAction, DEFAULT_MISSED_WINDOW_MINUTES };
