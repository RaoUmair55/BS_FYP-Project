import React, { useState, useEffect, useRef } from 'react';
import { Clock, AlertTriangle, Plus, CheckCircle, X, ChevronRight } from 'lucide-react';
import { getExams, getActiveSessions } from '../services/api';
import notify from '../utils/notify';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function ExamTimeExpiryAlert({ authFetch, socket, soundEnabled, playAlertChime }) {
    const [exams, setExams] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [extendingMap, setExtendingMap] = useState({});
    const [dismissedExams, setDismissedExams] = useState({});
    const [successMessage, setSuccessMessage] = useState(null);
    const alertedExamsRef = useRef(new Set());

    // 1-second ticker for smooth real-time remaining countdown
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Fetch active exams and sessions periodically
    const fetchData = async () => {
        try {
            const [examsRes, sessRes] = await Promise.all([
                getExams().catch(() => ({ data: [] })),
                getActiveSessions().catch(() => ({ data: [] }))
            ]);
            setExams(examsRes.data || []);
            setSessions(sessRes.data || []);
        } catch (err) {
            // Silently ignore background polling errors
        }
    };

    useEffect(() => {
        fetchData();
        const poll = setInterval(fetchData, 6000);
        return () => clearInterval(poll);
    }, []);

    // Listen to timeExtended socket events to immediately update state
    useEffect(() => {
        if (!socket) return;
        const handleTimeExtended = (data) => {
            fetchData();
            if (data?.examId) {
                setSuccessMessage(`Exam ${data.examId} extended by +${data.addMinutes} mins`);
                setTimeout(() => setSuccessMessage(null), 5000);
            }
        };
        socket.on('timeExtended', handleTimeExtended);
        return () => socket.off('timeExtended', handleTimeExtended);
    }, [socket]);

    // Extend time handler
    const handleExtendTime = async (examTarget, addMinutes) => {
        const examId = examTarget._id || examTarget.examCode || examTarget.examId;
        const code = examTarget.examCode || examTarget.examId || examId;
        setExtendingMap(prev => ({ ...prev, [code]: true }));

        try {
            const fetchFn = authFetch || fetch;
            const res = await fetchFn(`${API_BASE_URL}/exams/${examId}/extend-time`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addMinutes })
            });

            if (res.ok) {
                await res.json().catch(() => ({}));
                notify.success(`Extended ${code} by +${addMinutes}m`, 'All active candidates have received the updated end time.');
                setSuccessMessage(`Extended ${code} by +${addMinutes}m. New end time updated.`);
                setTimeout(() => setSuccessMessage(null), 6000);
                // Clear dismissal if extended
                setDismissedExams(prev => {
                    const copy = { ...prev };
                    delete copy[code];
                    return copy;
                });
                await fetchData();
            } else {
                const errData = await res.json().catch(() => ({}));
                notify.error('Time Extension Failed', errData.error || 'Could not extend exam time.');
            }
        } catch (err) {
            console.error('Failed to extend exam time:', err);
            notify.error('Time Extension Failed', err.message || 'Network error while extending exam time.');
        } finally {
            setExtendingMap(prev => ({ ...prev, [code]: false }));
        }
    };

    const handleDismiss = (code) => {
        // Dismiss for 3 minutes or until teacher reloads
        setDismissedExams(prev => ({
            ...prev,
            [code]: Date.now() + 3 * 60 * 1000
        }));
    };

    // Calculate expiring exams (active exams with <= 5 minutes remaining and > 0)
    const activeExams = exams.filter(e => e.status === 'active');
    const expiringExamsList = [];

    activeExams.forEach(exam => {
        const code = exam.examCode || exam.examId;
        
        // Check if dismissed
        if (dismissedExams[code] && currentTime < dismissedExams[code]) {
            return;
        }

        // Determine effective end time: from exam or from candidate sessions
        let effectiveEndTimeMs = null;
        if (exam.endTime) {
            effectiveEndTimeMs = new Date(exam.endTime).getTime();
        } else {
            // Find active sessions for this exam
            const matchingSessions = sessions.filter(s => 
                (s.examId === code || s.examId === exam._id) && s.endTime
            );
            if (matchingSessions.length > 0) {
                effectiveEndTimeMs = Math.max(...matchingSessions.map(s => new Date(s.endTime).getTime()));
            }
        }

        if (effectiveEndTimeMs) {
            const diffMs = effectiveEndTimeMs - currentTime;
            const diffSecs = Math.floor(diffMs / 1000);
            
            // <= 5 minutes (300 seconds) and not yet expired (> 0 seconds)
            if (diffSecs > 0 && diffSecs <= 300) {
                const mins = Math.floor(diffSecs / 60);
                const secs = diffSecs % 60;
                expiringExamsList.push({
                    exam,
                    code,
                    title: exam.title || code,
                    diffSecs,
                    mins,
                    secs,
                    timeFormatted: `${mins}m ${String(secs).padStart(2, '0')}s`
                });

                // Play audio chime once when entering the 5-minute zone
                if (!alertedExamsRef.current.has(code)) {
                    alertedExamsRef.current.add(code);
                    if (soundEnabled && typeof playAlertChime === 'function') {
                        playAlertChime();
                    }
                }
            }
        }
    });

    if (expiringExamsList.length === 0 && !successMessage) {
        return null;
    }

    return (
        <div style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            width: '100%',
            background: 'var(--fluent-glass-bg)',
            backdropFilter: 'blur(16px) saturate(150%)',
            WebkitBackdropFilter: 'blur(16px) saturate(150%)',
            color: 'var(--text-main)',
            borderBottom: '1px solid var(--border-color)',
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)',
            animation: 'glassFadeIn 0.25s ease-out'
        }}>
            {successMessage && (
                <div style={{
                    background: 'linear-gradient(90deg, rgba(22, 163, 74, 0.12), rgba(22, 163, 74, 0.04))',
                    color: 'var(--text-main)',
                    padding: '9px 24px',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderLeft: '3px solid var(--success)',
                    borderBottom: '1px solid rgba(22, 163, 74, 0.18)'
                }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <CheckCircle size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                        <span>{successMessage}</span>
                    </span>
                    <button 
                        onClick={() => setSuccessMessage(null)}
                        aria-label="Dismiss notification"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: '4px', borderRadius: '6px' }}
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {expiringExamsList.map(item => {
                const isExtending = extendingMap[item.code] || false;

                return (
                    <div 
                        key={item.code} 
                        style={{
                            padding: '10px 24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '12px',
                            background: 'linear-gradient(90deg, rgba(217, 119, 6, 0.10) 0%, rgba(217, 119, 6, 0.03) 65%, transparent 100%)',
                            borderLeft: '3px solid var(--warning)',
                            borderTop: '1px solid var(--border-color)'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            <div style={{
                                background: 'var(--warning-soft)',
                                color: 'var(--warning)',
                                width: '34px',
                                height: '34px',
                                borderRadius: '8px',
                                border: '1px solid rgba(217, 119, 6, 0.22)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                <Clock size={17} />
                            </div>

                            <div style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                                        Exam Ending Soon: {item.title} ({item.code})
                                    </span>
                                    <span className="tabular-nums" style={{
                                        background: 'var(--danger-soft)',
                                        color: 'var(--danger)',
                                        border: '1px solid rgba(220, 38, 38, 0.25)',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        letterSpacing: '0.02em'
                                    }}>
                                        {item.timeFormatted} left
                                    </span>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                    Active sessions will auto-submit at 0:00. Extend time for all candidates if needed.
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginRight: '2px' }}>
                                Extend:
                            </span>

                            {[5, 10, 15].map(mins => (
                                <button
                                    key={mins}
                                    type="button"
                                    className="md-btn md-btn-outlined md-btn-sm"
                                    onClick={() => handleExtendTime(item.exam, mins)}
                                    disabled={isExtending}
                                >
                                    <Plus size={12} />
                                    <span>{mins}m</span>
                                </button>
                            ))}

                            <button
                                type="button"
                                className="md-btn md-btn-text md-btn-sm"
                                onClick={() => handleDismiss(item.code)}
                                title="Dismiss for 3 minutes"
                                style={{ marginLeft: '2px' }}
                            >
                                <X size={13} />
                                <span>Dismiss</span>
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
