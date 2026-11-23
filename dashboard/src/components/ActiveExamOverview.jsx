import React, { useEffect, useState } from 'react';
import { Clock, Send, Plus, CheckCircle, Smartphone, Globe, Building2, Lock } from 'lucide-react';
import notify from '../utils/notify';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function ActiveExamOverview({
    activeExams = [],
    activeSessions = [],
    selectedExamFilter,
    onSelectExamFilter,
    onRequestEndExam,
    onRefresh,
    authFetch
}) {
    const [now, setNow] = useState(Date.now());
    const [busyAction, setBusyAction] = useState(null);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    if (!activeExams || activeExams.length === 0) return null;

    const currentExam = selectedExamFilter
        ? activeExams.find(e => String(e.examCode || e.examId || '').toUpperCase() === String(selectedExamFilter).toUpperCase()) || activeExams[0]
        : activeExams[0];

    if (!currentExam) return null;

    const examCode = currentExam.examCode || currentExam.examId || '';
    const examSessions = (activeSessions || []).filter(s =>
        String(s.examId || '').toUpperCase() === String(examCode).toUpperCase()
    );

    const isWaitingLobby = Boolean(currentExam.paperPath && currentExam.paperReleased === false);
    const connectedCount = examSessions.filter(s => s.status === 'active').length;
    const lobbyCount = examSessions.filter(s => s.status === 'active' && !s.endTime).length;
    const submittedCount = examSessions.filter(s => s.status === 'completed').length;
    const terminatedCount = examSessions.filter(s => s.status === 'terminated').length;

    const totalMins = (Number(currentExam.durationMinutes) || 60) + (Number(currentExam.extraMinutes) || 0);
    const totalMs = totalMins * 60 * 1000;

    let remainingLabel = isWaitingLobby ? 'Waiting Lobby' : `${totalMins}m Scheduled`;
    let progressPct = 0;
    let isUrgent = false;

    const endMs = currentExam.endTime
        ? new Date(currentExam.endTime).getTime()
        : (currentExam.startedAt ? new Date(currentExam.startedAt).getTime() + totalMs : null);

    if (endMs && !isWaitingLobby) {
        const diffMs = endMs - now;
        const elapsedMs = Math.max(0, totalMs - Math.max(0, diffMs));
        progressPct = totalMs > 0 ? Math.min(100, Math.round((elapsedMs / totalMs) * 100)) : 0;

        if (diffMs <= 0) {
            remainingLabel = 'Ended / Closing';
            progressPct = 100;
            isUrgent = true;
        } else {
            const totalSecs = Math.floor(diffMs / 1000);
            const hrs = Math.floor(totalSecs / 3600);
            const mins = Math.floor((totalSecs % 3600) / 60);
            const secs = totalSecs % 60;
            isUrgent = totalSecs < 5 * 60;
            remainingLabel = hrs > 0
                ? `${hrs}h ${String(mins).padStart(2, '0')}m left`
                : `${mins}m ${String(secs).padStart(2, '0')}s left`;
        }
    }

    const handleReleasePaper = async () => {
        if (!examCode || busyAction) return;
        setBusyAction('release');
        try {
            const res = await authFetch(`${API_BASE}/exams/${encodeURIComponent(examCode)}/release-paper`, { method: 'POST' });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to release paper');
            notify.success('Examination Started', `Question paper released for ${examCode}.`);
            if (onRefresh) onRefresh();
        } catch (err) {
            notify.error('Release Failed', err.message || 'Could not release exam paper.');
        } finally {
            setBusyAction(null);
        }
    };

    const handleExtendTime = async (addMinutes) => {
        if (!examCode || busyAction) return;
        setBusyAction(`extend-${addMinutes}`);
        try {
            const res = await authFetch(`${API_BASE}/exams/${encodeURIComponent(examCode)}/extend-time`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addMinutes })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to extend time');
            notify.success(`Extended by +${addMinutes}m`, `Updated exam end time for all candidates in ${examCode}.`);
            if (onRefresh) onRefresh();
        } catch (err) {
            notify.error('Extension Failed', err.message || 'Could not extend exam time.');
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <section className="active-exam-overview-card" aria-label="Active Examination Overview">
            <div className="active-exam-overview-top">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="md-badge status-active" style={{ fontSize: '11px' }}>
                            <span className="live-dot" />
                            <span>{isWaitingLobby ? 'WAITING LOBBY' : 'EXAM IN PROGRESS'}</span>
                        </span>
                        <span className="exam-code-badge" style={{ fontSize: '11.5px', padding: '2px 8px' }}>
                            {examCode}
                        </span>
                        <span className="md-badge" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)', fontSize: '11px' }}>
                            {currentExam.examType === 'physical_lab' ? <Building2 size={11} /> : <Globe size={11} />}
                            <span>{currentExam.examType === 'physical_lab' ? 'On-Campus Lab' : 'Remote Online'}</span>
                        </span>
                        {currentExam.requireSecondaryCamera && (
                            <span className="md-badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: '11px' }}>
                                <Smartphone size={11} />
                                <span>Dual-Angle Active</span>
                            </span>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-main)' }}>
                            {currentExam.title || examCode}
                        </h3>
                        {activeExams.length > 1 && (
                            <select
                                className="md-select"
                                value={selectedExamFilter || ''}
                                onChange={(e) => onSelectExamFilter(e.target.value || null)}
                                style={{ width: 'auto', padding: '4px 10px', fontSize: '12px', height: '30px' }}
                                aria-label="Switch active examination"
                            >
                                <option value="">All Active Exams ({activeExams.length})</option>
                                {activeExams.map(ex => (
                                    <option key={ex._id || ex.examCode} value={ex.examCode}>
                                        {ex.title} ({ex.examCode})
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                {/* Teacher Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {isWaitingLobby ? (
                        <button
                            type="button"
                            className="solid-primary-btn pill-btn"
                            disabled={Boolean(busyAction)}
                            onClick={handleReleasePaper}
                        >
                            <Send size={14} />
                            <span>{busyAction === 'release' ? 'Starting…' : 'Release Paper & Start'}</span>
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                className="frosted-secondary-btn pill-btn"
                                disabled={Boolean(busyAction)}
                                onClick={() => handleExtendTime(5)}
                                title="Add 5 minutes for all candidates in this exam"
                            >
                                <Plus size={13} />
                                <span>5m</span>
                            </button>
                            <button
                                type="button"
                                className="frosted-secondary-btn pill-btn"
                                disabled={Boolean(busyAction)}
                                onClick={() => handleExtendTime(10)}
                                title="Add 10 minutes for all candidates in this exam"
                            >
                                <Plus size={13} />
                                <span>10m</span>
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        className="solid-danger-btn pill-btn"
                        onClick={() => onRequestEndExam(examCode)}
                    >
                        <CheckCircle size={14} />
                        <span>End Exam</span>
                    </button>
                </div>
            </div>

            {/* Real-Time Exam Roster & Timer Breakdown */}
            <div className="active-exam-overview-metrics">
                <div className="exam-mini-stat">
                    <span className="exam-mini-stat-label">Connected</span>
                    <span className="exam-mini-stat-val tabular-nums" style={{ color: 'var(--success)' }}>{connectedCount}</span>
                </div>
                <div className="exam-mini-stat">
                    <span className="exam-mini-stat-label">In Lobby</span>
                    <span className="exam-mini-stat-val tabular-nums" style={{ color: lobbyCount > 0 ? 'var(--primary)' : 'var(--text-main)' }}>{lobbyCount}</span>
                </div>
                <div className="exam-mini-stat">
                    <span className="exam-mini-stat-label">Submitted</span>
                    <span className="exam-mini-stat-val tabular-nums">{submittedCount}</span>
                </div>
                <div className="exam-mini-stat">
                    <span className="exam-mini-stat-label">Terminated</span>
                    <span className="exam-mini-stat-val tabular-nums" style={{ color: terminatedCount > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{terminatedCount}</span>
                </div>
                <div className="exam-mini-stat">
                    <span className="exam-mini-stat-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        {isWaitingLobby ? <Lock size={11} /> : <Clock size={11} />}
                        <span>Time Left</span>
                    </span>
                    <span
                        className="exam-mini-stat-val tabular-nums"
                        style={{ fontSize: '15.5px', color: isUrgent ? 'var(--danger)' : isWaitingLobby ? 'var(--primary)' : 'var(--text-main)' }}
                    >
                        {remainingLabel}
                    </span>
                </div>
            </div>

            {/* Examination Time Progress Bar */}
            {!isWaitingLobby && endMs && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        <span>Examination Progress ({totalMins} min total)</span>
                        <span className="tabular-nums" style={{ fontWeight: 600 }}>{progressPct}% elapsed</span>
                    </div>
                    <div className="exam-progress-track">
                        <div
                            className="exam-progress-fill"
                            style={{
                                width: `${progressPct}%`,
                                background: isUrgent ? 'var(--danger)' : undefined
                            }}
                        />
                    </div>
                </div>
            )}
        </section>
    );
}
