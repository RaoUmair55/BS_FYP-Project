export function selectLiveAlerts(items, activeExams, examId, sessionId) {
    const key = value => String(value || '').trim().toUpperCase();
    const activeCodes = new Set(activeExams.filter(exam => exam.status === 'active')
        .flatMap(exam => [exam.examCode, exam.examId, exam._id]).filter(Boolean).map(key));
    const byId = new Map();
    for (const item of items) {
        if (!activeCodes.has(key(item.examId))) continue;
        if (examId && key(item.examId) !== key(examId)) continue;
        if (sessionId && String(item.sessionId) !== String(sessionId)) continue;
        byId.set(String(item._id || item.id || item.eventId), item);
    }
    return [...byId.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
