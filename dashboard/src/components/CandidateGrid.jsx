import React, { useEffect, useState } from 'react';
import { getActiveSessions, getExams } from '../services/api';
import RiskScoreBadge from './RiskScoreBadge';
import { 
    Users, Camera, Eye, MessageSquare, UserX, AlertTriangle, 
    ShieldCheck, Clock, RefreshCw, Grid, Check, Lock, Unlock, Send
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Components.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function CandidateGrid({ riskScores = {}, violations = [], onSelectCandidate, onOpenChat, examFilter }) {
    const { authFetch } = useAuth();
    const [sessions, setSessions] = useState([]);
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [extendingMap, setExtendingMap] = useState({});
    const [releasingMap, setReleasingMap] = useState({});
    const [verifyingMap, setVerifyingMap] = useState({});
    const [currentTime, setCurrentTime] = useState(Date.now());

    // Update current time ticker every second for accurate countdown
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Filter sessions by examFilter if selected
    const filteredSessions = sessions.filter(s => {
        if (examFilter && s.examId && s.examId.toUpperCase() !== examFilter.toUpperCase()) {
            return false;
        }
        return true;
    });

    const handleReleasePaper = async (examId) => {
        if (!examId) return;
        setReleasingMap(prev => ({ ...prev, [examId]: true }));
        try {
            const res = await authFetch(`${API_BASE_URL}/exams/${examId}/release-paper`, {
                method: 'POST'
            });
            if (res.ok) {
                fetchSessions();
            }
        } catch (err) {
            console.error('Failed to release question paper:', err);
        } finally {
            setReleasingMap(prev => ({ ...prev, [examId]: false }));
        }
    };

    const handleExtendTime = async (examId, addMinutes) => {
        if (!examId) return;
        setExtendingMap(prev => ({ ...prev, [examId]: true }));
        try {
            const res = await authFetch(`${API_BASE_URL}/exams/${examId}/extend-time`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addMinutes })
            });
            if (res.ok) {
                fetchSessions();
            }
        } catch (err) {
            console.error('Failed to extend exam time:', err);
        } finally {
            setExtendingMap(prev => ({ ...prev, [examId]: false }));
        }
    };

    const formatRemainingTime = (endTimeStr) => {
        if (!endTimeStr) return { text: 'In Lobby (Standby)', isUrgent: false, isExpired: false, minutesLeft: 999, isLobby: true };
        const endMs = new Date(endTimeStr).getTime();
        const diffSecs = Math.floor((endMs - currentTime) / 1000);
        if (diffSecs <= 0) return { text: 'Time Expired', isUrgent: true, isExpired: true, minutesLeft: 0 };
        const mins = Math.floor(diffSecs / 60);
        const secs = diffSecs % 60;
        const isUrgent = mins < 5;
        if (mins >= 60) {
            const hrs = Math.floor(mins / 60);
            const remMins = mins % 60;
            return { text: `${hrs}h ${remMins}m left`, isUrgent: false, isExpired: false, minutesLeft: mins };
        }
        return { 
            text: isUrgent ? `${mins}m ${secs}s left` : `${mins}m left`, 
            isUrgent, 
            isExpired: false, 
            minutesLeft: mins 
        };
    };

    // Find any active exams with unreleased papers (Waiting Lobby active)
    const unreleasedExams = exams.filter(e => {
        const isFiltered = examFilter ? (e.examCode === examFilter || e.examId === examFilter) : true;
        return isFiltered && e.status === 'active' && !e.paperReleased && e.paperPath;
    });

    // Find any active exams nearing completion (< 5 mins)
    const expiringExams = Array.from(new Set(
        filteredSessions
            .filter(s => {
                if (!s.endTime) return false;
                const endMs = new Date(s.endTime).getTime();
                const diffMs = endMs - currentTime;
                return diffMs > 0 && diffMs <= 5 * 60 * 1000;
            })
            .map(s => s.examId)
    ));

    const fetchSessions = () => {
        Promise.all([
            getActiveSessions().catch(e => ({ data: [] })),
            getExams().catch(e => ({ data: [] }))
        ])
        .then(([sessRes, examsRes]) => {
            setSessions(sessRes.data || []);
            setExams(examsRes.data || []);
            setLoading(false);
        })
        .catch(err => {
            console.error("Error fetching candidate grid sessions/exams:", err);
            setLoading(false);
        });
    };

    useEffect(() => {
        fetchSessions();
        const interval = setInterval(fetchSessions, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleConfirmIdentity = async (sid, e) => {
        if (e) e.stopPropagation();
        if (!sid) return;

        // Optimistically mark verified
        setSessions(prev => prev.map(s => {
            const currentId = s.sessionId || s._id;
            if (currentId === sid) {
                return { ...s, cameraVerificationStatus: 'verified' };
            }
            return s;
        }));

        setVerifyingMap(prev => ({ ...prev, [sid]: true }));

        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sid}/camera-verification`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'verified' })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.session) {
                    setSessions(prev => prev.map(s => {
                        const currentId = s.sessionId || s._id;
                        if (currentId === sid) {
                            return { ...s, ...data.session };
                        }
                        return s;
                    }));
                }
            }
        } catch (err) {
            console.error('Failed to verify identity:', err);
        } finally {
            setVerifyingMap(prev => ({ ...prev, [sid]: false }));
        }
    };

    // Count unreviewed violations per candidate
    const unreviewedBySession = (violations || []).reduce((acc, v) => {
        if (!v.reviewed && v.sessionId && v.decision !== 'dismissed') {
            acc[v.sessionId] = (acc[v.sessionId] || 0) + 1;
        }
        return acc;
    }, {});

    if (loading) {
        return (
            <div className="md-card candidate-grid-card">
                <div className="md-loading">
                    <RefreshCw size={24} className="spin" />
                    <span>Loading candidate webcam grid...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="md-card candidate-grid-card" style={{ overflowY: 'auto', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Grid size={18} style={{ color: '#1a73e8' }} />
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#202124' }}>
                        Live Candidate Webcam Grid
                    </h3>
                </div>
                <span className="md-badge status-active">
                    <Users size={12} />
                    <span>{filteredSessions.length} Active Candidates</span>
                </span>
            </div>

            {/* Waiting Lobby Paper Release Banner */}
            {unreleasedExams.map(ex => {
                const exCode = ex.examCode || ex.examId || '';
                const lobbyStudents = sessions.filter(s => {
                    const sExam = s.examId || '';
                    return sExam.toUpperCase() === exCode.toUpperCase() && s.status === 'active';
                });

                return (
                    <div key={exCode} style={{
                        marginBottom: '16px',
                        padding: '16px 20px',
                        borderRadius: '10px',
                        background: '#eff6ff',
                        border: '1.5px solid #93c5fd',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.1)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ background: '#dbeafe', padding: '10px', borderRadius: '10px', color: '#1d4ed8' }}>
                                    <Lock size={22} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>Waiting Lobby Active &mdash; {ex.title || ex.examCode} ({ex.examCode})</span>
                                        <span style={{ 
                                            background: lobbyStudents.length > 0 ? '#10b981' : '#f59e0b', 
                                            color: '#ffffff', 
                                            fontSize: '11px', 
                                            padding: '2px 8px', 
                                            borderRadius: '12px', 
                                            fontWeight: 700 
                                        }}>
                                            {lobbyStudents.length} Students Joined
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '12.5px', color: '#3b82f6', marginTop: '2px' }}>
                                        Verify all enrolled students have joined the lobby below. When ready, click release to unlock the question paper and start the exam timer for everyone simultaneously.
                                    </div>
                                </div>
                            </div>

                            <button
                                className="md-btn"
                                style={{ 
                                    background: '#2563eb', 
                                    color: '#ffffff', 
                                    fontSize: '13px', 
                                    padding: '10px 20px', 
                                    borderRadius: '8px', 
                                    border: 'none', 
                                    fontWeight: 700, 
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)'
                                }}
                                disabled={releasingMap[exCode]}
                                onClick={() => handleReleasePaper(exCode)}
                            >
                                <Send size={15} />
                                <span>{releasingMap[exCode] ? 'Releasing Paper...' : `🚀 Release Paper & Start Exam (${lobbyStudents.length} Ready)`}</span>
                            </button>
                        </div>

                        {/* Joined Students Quick Chips */}
                        <div style={{ 
                            background: '#ffffff', 
                            border: '1px solid #bfdbfe', 
                            borderRadius: '6px', 
                            padding: '8px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px'
                        }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>
                                Joined Candidates ({lobbyStudents.length}):
                            </span>
                            {lobbyStudents.length === 0 ? (
                                <span style={{ fontSize: '11.5px', color: '#94a3b8', fontStyle: 'italic' }}>
                                    Waiting for candidates to enter the exam code and join lobby...
                                </span>
                            ) : (
                                lobbyStudents.map(s => (
                                    <span key={s.sessionId || s._id} style={{
                                        fontSize: '11px',
                                        background: '#f0fdf4',
                                        color: '#15803d',
                                        border: '1px solid #bbf7d0',
                                        padding: '2px 8px',
                                        borderRadius: '12px',
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}>
                                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }}></span>
                                        {s.studentName || 'Candidate'} {s.rollNumber ? `(${s.rollNumber})` : ''}
                                    </span>
                                ))
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Expiring Exams Alert Banner (< 5 mins remaining) */}
            {expiringExams.length > 0 && (
                <div style={{
                    marginBottom: '16px',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    boxShadow: '0 2px 4px rgba(245, 158, 11, 0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <AlertTriangle size={20} style={{ color: '#d97706', flexShrink: 0 }} />
                        <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#92400e' }}>
                                ⏳ Exam Approaching Time Limit (Under 5 Minutes Remaining)
                            </div>
                            <div style={{ fontSize: '12px', color: '#b45309' }}>
                                Active exam: <strong>{expiringExams.join(', ')}</strong>. Unsubmitted sessions will auto-submit when the timer expires.
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#92400e' }}>Extend:</span>
                        {expiringExams.map(exCode => (
                            <React.Fragment key={exCode}>
                                <button
                                    className="md-btn md-btn-sm"
                                    style={{ background: '#d97706', color: '#ffffff', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                                    disabled={extendingMap[exCode]}
                                    onClick={() => handleExtendTime(exCode, 5)}
                                >
                                    +5m
                                </button>
                                <button
                                    className="md-btn md-btn-sm"
                                    style={{ background: '#b45309', color: '#ffffff', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                                    disabled={extendingMap[exCode]}
                                    onClick={() => handleExtendTime(exCode, 10)}
                                >
                                    +10m
                                </button>
                                <button
                                    className="md-btn md-btn-sm"
                                    style={{ background: '#78350f', color: '#ffffff', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                                    disabled={extendingMap[exCode]}
                                    onClick={() => handleExtendTime(exCode, 15)}
                                >
                                    +15m
                                </button>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            )}

            {filteredSessions.length === 0 ? (
                <div className="md-empty-card" style={{ border: 'none', background: 'transparent' }}>
                    <Users size={40} className="md-empty-icon" />
                    <p style={{ margin: 0 }}>No active candidate sessions found.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                    {filteredSessions.map((s) => {
                        const sid = s.sessionId || s._id;
                        const currentScore = riskScores[sid] !== undefined ? riskScores[sid] : s.riskScore;
                        const pendingAlerts = unreviewedBySession[sid] || 0;
                        const cameraStatus = s.cameraVerificationStatus || 'none';
                        const isVerified = cameraStatus === 'verified';
                        const timeInfo = formatRemainingTime(s.endTime);
                        const photoUrl = s.cameraVerificationPhoto 
                            ? (s.cameraVerificationPhoto.startsWith('http://') || s.cameraVerificationPhoto.startsWith('https://')
                                ? s.cameraVerificationPhoto
                                : `${API_BASE_URL.replace(/\/$/, '')}/${s.cameraVerificationPhoto.replace(/^\//, '')}`)
                            : null;
                        const isVerifying = verifyingMap[sid] || false;
                        const isExtending = extendingMap[s.examId] || false;

                        return (
                            <div 
                                key={sid}
                                className="md-card candidate-webcam-card"
                                style={{
                                    border: currentScore >= 60 ? '2px solid #d93025' : currentScore >= 30 ? '2px solid #f9ab00' : timeInfo.isUrgent ? '2px solid #f59e0b' : '1px solid #dadce0',
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    background: '#ffffff',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    boxShadow: '0 1px 3px rgba(60,64,67,0.12)'
                                }}
                            >
                                {/* Card Header */}
                                <div style={{ padding: '10px 12px', background: '#f8f9fa', borderBottom: '1px solid #dadce0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#202124' }}>
                                            {s.studentName || s.studentId || 'Candidate'}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#5f6368', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                            <span>{s.rollNumber ? `${s.rollNumber} • ` : ''}Code: {s.examId}</span>
                                            {/* Remaining Time Badge */}
                                            <span style={{
                                                fontSize: '10px',
                                                padding: '1px 6px',
                                                borderRadius: '10px',
                                                fontWeight: 600,
                                                background: timeInfo.isLobby ? '#e0f2fe' : timeInfo.isExpired ? '#fee2e2' : timeInfo.isUrgent ? '#fef3c7' : '#ecfdf5',
                                                color: timeInfo.isLobby ? '#0369a1' : timeInfo.isExpired ? '#b91c1c' : timeInfo.isUrgent ? '#92400e' : '#047857',
                                                border: `1px solid ${timeInfo.isLobby ? '#bae6fd' : timeInfo.isExpired ? '#fca5a5' : timeInfo.isUrgent ? '#fcd34d' : '#a7f3d0'}`
                                            }}>
                                                ⏱️ {timeInfo.text}
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {pendingAlerts > 0 && (
                                            <span className="md-badge status-draft" style={{ fontSize: '10px', padding: '1px 5px' }}>
                                                {pendingAlerts} New
                                            </span>
                                        )}
                                        <RiskScoreBadge score={currentScore} />
                                    </div>
                                </div>

                                {/* Webcam / Verification Area */}
                                <div style={{ height: '160px', background: '#0f172a', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {/* If NOT verified yet and photo exists, show the self-check photo for verification */}
                                    {!isVerified && photoUrl ? (
                                        <img 
                                            src={photoUrl} 
                                            alt={`Self-check photo ${s.studentId}`} 
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                        />
                                    ) : isVerified ? (
                                        /* Once verified, photo disappears cleanly and displays active live monitoring feed */
                                        <div style={{ textAlign: 'center', color: '#10b981', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <ShieldCheck size={36} style={{ color: '#10b981' }} />
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>Identity Verified</div>
                                            <div style={{ fontSize: '10px', color: '#94a3b8' }}>Camera Active ● Live</div>
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', color: '#64748b' }}>
                                            <Camera size={32} style={{ marginBottom: '4px', opacity: 0.6 }} />
                                            <div style={{ fontSize: '11px' }}>Camera Active</div>
                                        </div>
                                    )}

                                    {/* Verification Badge Overlay */}
                                    <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', padding: '2px 8px', borderRadius: '12px', color: '#fff', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        {isVerified ? <ShieldCheck size={11} style={{ color: '#34d399' }} /> : <Clock size={11} style={{ color: '#fbbf24' }} />}
                                        <span style={{ textTransform: 'capitalize' }}>{isVerified ? 'Identity Confirmed' : 'Self-Check Check Required'}</span>
                                    </div>
                                </div>

                                {/* Action Buttons Footer */}
                                <div style={{ padding: '8px 12px', background: '#ffffff', borderTop: '1px solid #e8eaed', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                                    {!isVerified && photoUrl && (
                                        <button 
                                            className="md-btn md-btn-sm"
                                            style={{ flex: 1, fontSize: '11px', padding: '4px 6px', background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }}
                                            onClick={(e) => handleConfirmIdentity(sid, e)}
                                            disabled={isVerifying}
                                            title="Confirm student identity and clear self-check photo"
                                        >
                                            <Check size={12} />
                                            <span>{isVerifying ? 'Confirming...' : 'Confirm Identity'}</span>
                                        </button>
                                    )}

                                    <button 
                                        className="md-btn md-btn-sm md-btn-outlined"
                                        style={{ flex: !isVerified && photoUrl ? 'unset' : 1, fontSize: '11px', padding: '4px 8px' }}
                                        onClick={() => onSelectCandidate && onSelectCandidate(sid)}
                                        title="View full evidence timeline & screenshots"
                                    >
                                        <Eye size={12} />
                                        <span>Review</span>
                                    </button>

                                    {onOpenChat && (
                                        <button
                                            className="md-btn md-btn-sm"
                                            style={{ fontSize: '11px', padding: '4px 8px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}
                                            onClick={() => onOpenChat(sid)}
                                            title="Open direct live chat with this student"
                                        >
                                            <MessageSquare size={12} />
                                            <span>Chat</span>
                                        </button>
                                    )}

                                    <button
                                        className="md-btn md-btn-sm"
                                        style={{ fontSize: '11px', padding: '4px 6px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}
                                        onClick={() => handleExtendTime(s.examId, 5)}
                                        disabled={isExtending}
                                        title="Extend this exam's duration by 5 minutes"
                                    >
                                        +5m
                                    </button>
                                    <button
                                        className="md-btn md-btn-sm"
                                        style={{ fontSize: '11px', padding: '4px 6px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}
                                        onClick={() => handleExtendTime(s.examId, 10)}
                                        disabled={isExtending}
                                        title="Extend this exam's duration by 10 minutes"
                                    >
                                        +10m
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

