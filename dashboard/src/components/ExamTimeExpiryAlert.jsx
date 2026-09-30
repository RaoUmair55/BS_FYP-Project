import React, { useState, useEffect, useRef } from 'react';
import { Clock, AlertTriangle, Plus, CheckCircle, X, ChevronRight } from 'lucide-react';
import { getExams, getActiveSessions } from '../services/api';

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
                const data = await res.json();
                setSuccessMessage(`✅ Extended ${code} by +${addMinutes}m! New end time updated.`);
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
                alert(`Could not extend exam time: ${errData.error || 'Server error'}`);
            }
        } catch (err) {
            console.error('Failed to extend exam time:', err);
            alert(`Failed to extend exam time: ${err.message}`);
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
            zIndex: 900,
            width: '100%',
            background: 'linear-gradient(90deg, var(--warning-bg) 0%, var(--warning-bg) 40%, var(--warning-bg) 100%)',
            color: 'var(--text-on-color)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            borderBottom: '2px solid var(--warning)',
            animation: 'slideDown 0.3s ease-out'
        }}>
            {successMessage && (
                <div style={{
                    background: 'var(--success-bg)',
                    color: 'var(--text-on-color)',
                    padding: '8px 20px',
                    fontSize: '13px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid var(--success)'
                }}>
                    <span>{successMessage}</span>
                    <button 
                        onClick={() => setSuccessMessage(null)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-on-color)', cursor: 'pointer', fontSize: '14px' }}
                    >
                        ✕
                    </button>
                </div>
            )}

            {expiringExamsList.map(item => {
                const isExtending = extendingMap[item.code] || false;

                return (
                    <div 
                        key={item.code} 
                        style={{
                            padding: '12px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '12px',
                            borderTop: '1px solid rgba(255, 255, 255, 0.1)'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                background: 'var(--warning-soft)',
                                color: 'var(--warning)',
                                width: '36px',
                                height: '36px',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                <Clock size={20} className="pulse-icon" />
                            </div>

                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.2px' }}>
                                        ⏳ Exam Ending Soon: {item.title} ({item.code})
                                    </span>
                                    <span style={{
                                        background: 'var(--danger-bg)',
                                        color: 'var(--text-on-color)',
                                        fontSize: '11.5px',
                                        fontWeight: 800,
                                        padding: '2px 8px',
                                        borderRadius: '12px',
                                        letterSpacing: '0.4px',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                    }}>
                                        {item.timeFormatted} LEFT
                                    </span>
                                </div>
                                <div style={{ fontSize: '12px', color: '#fef3c7', marginTop: '2px' }}>
                                    Active sessions will auto-submit when the countdown reaches 0. Would you like to extend time for all candidates?
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#fde68a', marginRight: '4px' }}>
                                Add Time:
                            </span>

                            <button
                                onClick={() => handleExtendTime(item.exam, 5)}
                                disabled={isExtending}
                                style={{
                                    background: 'var(--bg-surface)',
                                    color: 'var(--warning)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    cursor: isExtending ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.15s ease',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--warning-soft)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
                            >
                                +5 Mins
                            </button>

                            <button
                                onClick={() => handleExtendTime(item.exam, 10)}
                                disabled={isExtending}
                                style={{
                                    background: 'var(--bg-surface)',
                                    color: 'var(--warning)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    cursor: isExtending ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.15s ease',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--warning-soft)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
                            >
                                +10 Mins
                            </button>

                            <button
                                onClick={() => handleExtendTime(item.exam, 15)}
                                disabled={isExtending}
                                style={{
                                    background: 'var(--bg-surface)',
                                    color: 'var(--warning)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    cursor: isExtending ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.15s ease',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--warning-soft)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
                            >
                                +15 Mins
                            </button>

                            <button
                                onClick={() => handleDismiss(item.code)}
                                title="Dismiss notification"
                                style={{
                                    background: 'rgba(255, 255, 255, 0.15)',
                                    color: 'var(--text-on-color)',
                                    border: '1px solid rgba(255, 255, 255, 0.3)',
                                    borderRadius: '6px',
                                    padding: '6px 10px',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    marginLeft: '4px'
                                }}
                            >
                                <X size={14} />
                                <span>Dismiss</span>
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
