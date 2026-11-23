import React, { useEffect, useState } from 'react';
import { getActiveSessions, getExams } from '../services/api';
import { assetUrl } from '../services/api';
import RiskScoreBadge from './RiskScoreBadge';
import { 
    Users, Camera, Eye, MessageSquare, UserX, AlertTriangle, 
    ShieldCheck, Clock, RefreshCw, Grid, Check, Lock, Unlock, Send,
    Smartphone, Wifi, Activity
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Components.css';
import { scopedExams, scopedSessions, matchesExam } from '../utils/examScope';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function CandidateGrid({
    riskScores = {},
    violations = [],
    onSelectCandidate,
    onOpenChat,
    examFilter,
    secondaryCameraStatuses = {},
    secondaryCameraMeta = {}
}) {
    const { authFetch } = useAuth();
    const [sessions, setSessions] = useState([]);
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'normal' | 'needs_review' | 'high_priority' | 'disconnected'
    const [extendingMap, setExtendingMap] = useState({});
    const [releasingMap, setReleasingMap] = useState({});
    const [verifyingMap, setVerifyingMap] = useState({});
    const [actionError, setActionError] = useState('');
    const [requestingMap, setRequestingMap] = useState({});
    const [currentTime, setCurrentTime] = useState(Date.now());

    // Update current time ticker every second for accurate countdown
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const visibleExams = scopedExams(exams, examFilter);
    const filteredSessions = scopedSessions(sessions, exams, examFilter);

    const handleReleasePaper = async (examId) => {
        if (!examId || !visibleExams.some(exam => matchesExam(exam, examId))) return;
        setActionError('');
        setReleasingMap(prev => ({ ...prev, [examId]: true }));
        try {
            const res = await authFetch(`${API_BASE_URL}/exams/${examId}/release-paper`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Exam action failed');
            fetchSessions();
        } catch (err) {
            setActionError(err.message || 'Unable to release paper');
        } finally {
            setReleasingMap(prev => ({ ...prev, [examId]: false }));
        }
    };

    const handleExtendTime = async (examId, addMinutes) => {
        if (!examId || !visibleExams.some(exam => matchesExam(exam, examId))) return;
        setActionError('');
        setExtendingMap(prev => ({ ...prev, [examId]: true }));
        try {
            const res = await authFetch(`${API_BASE_URL}/exams/${examId}/extend-time`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addMinutes })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Exam action failed');
            fetchSessions();
        } catch (err) {
            setActionError(err.message || 'Unable to extend time');
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
    const unreleasedExams = visibleExams.filter(e => !e.paperReleased && e.paperPath);

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
            getActiveSessions(),
            getExams()
        ])
        .then(([sessRes, examsRes]) => {
            setSessions(sessRes.data || []);
            setExams(examsRes.data || []);
            setLoading(false);
        })
        .catch(err => {
            setActionError('Unable to refresh the candidate grid. Check your connection; it will retry automatically.');
            setLoading(false);
        });
    };

    useEffect(() => {
        fetchSessions();
        const interval = setInterval(fetchSessions, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleConfirmIdentity = async (sid, e, photo) => {
        if (e) e.stopPropagation();
        if (!sid) return;

        setVerifyingMap(prev => ({ ...prev, [sid]: true }));

        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sid}/camera-verification`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'verified', photoUrl: photo?.url || sessions.find(session => (session.sessionId || session._id) === sid)?.cameraVerificationPhoto, historyPhotoId: photo?._id })
            });

            if (!res.ok) throw new Error((await res.json()).error || 'Unable to confirm identity');
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
            setActionError(err.message || 'Unable to confirm identity');
        } finally {
            setVerifyingMap(prev => ({ ...prev, [sid]: false }));
        }
    };

    const handleRequestPhoto = async (sid) => {
        const note = window.prompt('Note for candidate (optional):', 'Please face the camera and improve the lighting.');
        if (note === null) return;
        setActionError(''); setRequestingMap(prev => ({ ...prev, [sid]: true }));
        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sid}/request-camera-photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
            if (!res.ok) throw new Error((await res.json()).error || 'Unable to request photo');
            fetchSessions();
        } catch (err) { setActionError(err.message || 'Unable to request photo'); }
        finally { setRequestingMap(prev => ({ ...prev, [sid]: false })); }
    };

    // Count unreviewed violations per candidate
    const unreviewedBySession = (violations || []).reduce((acc, v) => {
        if (!v.reviewed && v.sessionId && v.decision !== 'dismissed') {
            acc[v.sessionId] = (acc[v.sessionId] || 0) + 1;
        }
        return acc;
    }, {});

    // Classify candidate state for Fluent filter tabs
    const classifySession = (s) => {
        const sid = s.sessionId || s._id;
        const score = riskScores[sid] !== undefined ? riskScores[sid] : (s.riskScore || 0);
        const pending = unreviewedBySession[sid] || 0;
        const sideStatus = secondaryCameraStatuses[sid] || s.secondaryCamera?.status;
        if (s.status === 'terminated' || sideStatus === 'lost') return 'disconnected';
        if (score >= 60) return 'high_priority';
        if (pending > 0 || score >= 30 || s.cameraVerificationStatus === 'pending') return 'needs_review';
        return 'normal';
    };

    const filterCounts = filteredSessions.reduce((acc, s) => {
        const bucket = classifySession(s);
        acc[bucket] = (acc[bucket] || 0) + 1;
        return acc;
    }, { normal: 0, needs_review: 0, high_priority: 0, disconnected: 0 });

    const displayedSessions = statusFilter === 'all'
        ? filteredSessions
        : filteredSessions.filter(s => classifySession(s) === statusFilter);

    if (loading) {
        return (
            <div className="md-card candidate-grid-card">
                <div className="md-loading">
                    <RefreshCw size={24} className="spin" />
                    <span>Loading candidate monitoring grid...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="md-card candidate-grid-card" style={{ overflowY: 'auto', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Grid size={18} style={{ color: 'var(--primary)' }} />
                    <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                        Live Candidate Monitoring Grid
                    </h3>
                </div>
                <span className="md-badge status-active">
                    <Users size={12} />
                    <span>{filteredSessions.length} Active Candidates</span>
                </span>
            </div>

            {/* Fluent Candidate Filter Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
                {[
                    { key: 'all', label: 'All Candidates', count: filteredSessions.length },
                    { key: 'normal', label: 'Normal', count: filterCounts.normal },
                    { key: 'needs_review', label: 'Needs Review', count: filterCounts.needs_review },
                    { key: 'high_priority', label: 'High Priority', count: filterCounts.high_priority },
                    { key: 'disconnected', label: 'Disconnected / Ended', count: filterCounts.disconnected }
                ].map(tab => {
                    const active = statusFilter === tab.key;
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setStatusFilter(tab.key)}
                            style={{
                                padding: '5px 11px',
                                borderRadius: '7px',
                                fontSize: '12px',
                                fontWeight: active ? 600 : 500,
                                border: active ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                                background: active ? 'var(--primary-soft)' : 'var(--bg-base)',
                                color: active ? 'var(--primary)' : 'var(--text-muted)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            <span>{tab.label}</span>
                            <span className="tabular-nums" style={{ fontSize: '11px', opacity: 0.85 }}>({tab.count})</span>
                        </button>
                    );
                })}
            </div>

            {actionError && <div className="md-alert md-alert-error" role="alert">{actionError}</div>}
            {visibleExams.map(exam => <div key={exam._id || exam.examCode} className="md-card" style={{ padding: 12, marginBottom: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <strong style={{ marginRight: 'auto' }}>{exam.examCode || exam.examId} · Extend time for all candidates</strong>
                {[5, 10].map(minutes => <button key={minutes} className="md-btn md-btn-sm md-btn-outlined" disabled={extendingMap[exam.examCode || exam.examId]} onClick={() => handleExtendTime(exam.examCode || exam.examId, minutes)}>+{minutes}m for everyone</button>)}
            </div>)}
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
                        background: 'var(--primary-soft)',
                        border: '1.5px solid var(--primary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.1)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ background: 'var(--primary-soft)', padding: '10px', borderRadius: '10px', color: 'var(--primary)' }}>
                                    <Lock size={22} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>Waiting Lobby Active &mdash; {ex.title || ex.examCode} ({ex.examCode})</span>
                                        <span style={{ 
                                            background: lobbyStudents.length > 0 ? 'var(--success-bg)' : 'var(--warning-bg)', 
                                            color: 'var(--text-on-color)', 
                                            fontSize: '11px', 
                                            padding: '2px 8px', 
                                            borderRadius: '12px', 
                                            fontWeight: 700 
                                        }}>
                                            {lobbyStudents.length} Students Joined
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '12.5px', color: 'var(--primary)', marginTop: '2px' }}>
                                        Verify all enrolled students have joined the lobby below. When ready, click release to unlock the question paper and start the exam timer for everyone simultaneously.
                                    </div>
                                </div>
                            </div>

                            <button
                                className="md-btn"
                                style={{ 
                                    background: 'var(--primary-bg)', 
                                    color: 'var(--text-on-color)', 
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
                                <span>{releasingMap[exCode] ? 'Releasing Paper...' : `Release Paper & Start Exam (${lobbyStudents.length} Ready)`}</span>
                            </button>
                        </div>

                        {/* Joined Students Quick Chips */}
                        <div style={{ 
                            background: 'var(--bg-surface)', 
                            border: '1px solid #bfdbfe', 
                            borderRadius: '6px', 
                            padding: '8px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px'
                        }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>
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
                                        background: 'var(--success-soft)',
                                        color: 'var(--success)',
                                        border: '1px solid var(--success-soft)',
                                        padding: '2px 8px',
                                        borderRadius: '12px',
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}>
                                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success-bg)' }}></span>
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
                    background: 'var(--warning-soft)',
                    border: '1px solid var(--warning-soft)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    boxShadow: '0 2px 4px rgba(245, 158, 11, 0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <AlertTriangle size={20} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                        <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--warning)' }}>
                                Exam Approaching Time Limit (Under 5 Minutes Remaining)
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--warning)' }}>
                                Active exam: <strong>{expiringExams.join(', ')}</strong>. Unsubmitted sessions will auto-submit when the timer expires.
                            </div>
                        </div>
                    </div>


                </div>
            )}

            {displayedSessions.length === 0 ? (
                <div className="md-empty-card" style={{ border: 'none', background: 'transparent' }}>
                    <Users size={36} className="md-empty-icon" />
                    <p style={{ margin: 0 }}>
                        {statusFilter === 'all' ? 'No active candidate sessions found.' : 'No candidates match the selected status filter.'}
                    </p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(275px, 1fr))', gap: '14px' }}>
                    {displayedSessions.map((s) => {
                        const sid = s.sessionId || s._id;
                        const isLab = visibleExams.some(exam => matchesExam(exam, s.examId) && exam.examType === 'physical_lab');
                        const requiresSide = Boolean(s.requireSecondaryCamera || s.secondaryCamera?.paired || secondaryCameraStatuses[sid]);
                        const sideStatus = secondaryCameraStatuses[sid] || s.secondaryCamera?.status || 'not_paired';
                        const isFixedStand = Boolean(secondaryCameraMeta[sid]?.fixedStandMode ?? s.secondaryCamera?.fixedStandMode);
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
                        const isTerminated = s.status === 'terminated';
                        const isCompleted = s.status === 'completed';

                        return (
                            <div 
                                key={sid}
                                className="md-card candidate-webcam-card"
                                style={{
                                    border: isTerminated ? '2px solid var(--danger)' : currentScore >= 60 ? '2px solid var(--danger)' : currentScore >= 30 ? '2px solid var(--warning)' : timeInfo.isUrgent ? '2px solid var(--warning)' : '1px solid var(--border-color)',
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    background: 'var(--bg-surface)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    boxShadow: '0 1px 3px rgba(60,64,67,0.12)'
                                }}
                            >
                                {/* Card Header */}
                                <div style={{ padding: '10px 12px', background: 'var(--bg-base)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)' }}>
                                            {s.studentName || s.studentId || 'Candidate'}
                                        </div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                            <span>{s.rollNumber ? `${s.rollNumber} • ` : ''}Code: {s.examId}</span>
                                            {/* Status / Remaining Time Badge */}
                                            {isTerminated ? (
                                                <span style={{
                                                    fontSize: '10px',
                                                    padding: '1px 6px',
                                                    borderRadius: '10px',
                                                    fontWeight: 600,
                                                    background: 'var(--danger-soft)',
                                                    color: 'var(--danger)',
                                                    border: '1px solid #fca5a5',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px'
                                                }} title={s.terminationReason || 'Terminated'}>
                                                    <UserX size={10} />
                                                    <span>Terminated</span>
                                                </span>
                                            ) : isCompleted ? (
                                                <span style={{
                                                    fontSize: '10px',
                                                    padding: '1px 6px',
                                                    borderRadius: '10px',
                                                    fontWeight: 600,
                                                    background: 'var(--success-soft)',
                                                    color: 'var(--success)',
                                                    border: '1px solid #a7f3d0',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px'
                                                }}>
                                                    <Check size={10} />
                                                    <span>Submitted</span>
                                                </span>
                                            ) : (
                                                <span style={{
                                                    fontSize: '10px',
                                                    padding: '1px 6px',
                                                    borderRadius: '10px',
                                                    fontWeight: 600,
                                                    background: timeInfo.isLobby ? 'var(--primary-soft)' : timeInfo.isExpired ? 'var(--danger-soft)' : timeInfo.isUrgent ? 'var(--warning-soft)' : 'var(--success-soft)',
                                                    color: timeInfo.isLobby ? '#0369a1' : timeInfo.isExpired ? 'var(--danger)' : timeInfo.isUrgent ? 'var(--warning)' : 'var(--success)',
                                                    border: `1px solid ${timeInfo.isLobby ? '#bae6fd' : timeInfo.isExpired ? '#fca5a5' : timeInfo.isUrgent ? '#fcd34d' : '#a7f3d0'}`,
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px'
                                                }}>
                                                    <Clock size={10} />
                                                    <span>{timeInfo.text}</span>
                                                </span>
                                            )}
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
                                    {isTerminated ? (
                                        <div style={{ textAlign: 'center', color: '#f87171', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '14px' }}>
                                            <AlertTriangle size={32} style={{ color: '#ef4444' }} />
                                            <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#f87171' }}>Session Terminated</div>
                                            <div style={{ fontSize: '11px', color: '#cbd5e1', maxWidth: '240px', lineHeight: 1.3 }}>
                                                {s.terminationReason || 'Terminated by rule or examiner'}
                                            </div>
                                        </div>
                                    ) : isCompleted ? (
                                        <div style={{ textAlign: 'center', color: 'var(--success)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '14px' }}>
                                            <ShieldCheck size={36} style={{ color: 'var(--success)' }} />
                                            <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#e2e8f0' }}>Exam Completed</div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Responses submitted</div>
                                        </div>
                                    ) : isLab ? (
                                        <p style={{ color: '#e2e8f0', padding: 16 }}>Physical lab · Camera checks disabled</p>
                                    ) : photoUrl ? (
                                        /* If NOT verified yet and photo exists, show the self-check photo for verification */
                                        <img 
                                            src={assetUrl(photoUrl)} 
                                            alt={`Latest identity photo for ${s.studentName || s.studentId}`}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                        />
                                    ) : isVerified ? (
                                        /* Legacy verified session without a retained image */
                                        <div style={{ textAlign: 'center', color: 'var(--success)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <ShieldCheck size={36} style={{ color: 'var(--success)' }} />
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>Identity Verified</div>
                                            <div style={{ fontSize: '10px', color: '#94a3b8' }}>Identity confirmation recorded</div>
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                            <Camera size={32} style={{ marginBottom: '4px', opacity: 0.6 }} />
                                            <div style={{ fontSize: '11px' }}>Camera Active</div>
                                        </div>
                                    )}

                                    {/* Verification Badge Overlay (only when active) */}
                                    {!isLab && !isTerminated && !isCompleted && (
                                        <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(15, 23, 42, 0.78)', backdropFilter: 'blur(6px)', padding: '3px 8px', borderRadius: '6px', color: '#ffffff', fontSize: '10.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            {isVerified ? <ShieldCheck size={11} style={{ color: '#22c55e' }} /> : <Clock size={11} style={{ color: '#f59e0b' }} />}
                                            <span>{isVerified ? 'Identity Confirmed' : 'Awaiting Review'}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Compact Live Telemetry Strip (Camera, Side Camera, AI & Connection) */}
                                {!isTerminated && !isCompleted && (
                                    <div style={{
                                        padding: '7px 12px',
                                        background: 'var(--bg-base)',
                                        borderBottom: '1px solid var(--border-color)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        flexWrap: 'wrap',
                                        gap: '6px',
                                        fontSize: '11px',
                                        color: 'var(--text-muted)'
                                    }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: isLab ? 'var(--text-muted)' : 'var(--success)', fontWeight: 500 }}>
                                            <Activity size={11} />
                                            <span>{isLab ? 'Lab Lockdown' : 'AI Monitoring'}</span>
                                        </span>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: sideStatus === 'lost' ? 'var(--danger)' : 'var(--success)', fontWeight: 500 }}>
                                            <Wifi size={11} />
                                            <span>{sideStatus === 'lost' ? 'Side Lost' : 'Connected'}</span>
                                        </span>
                                        {requiresSide && (
                                            <span
                                                title={isFixedStand ? 'Fixed Stand Mode active on side camera' : undefined}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px',
                                                    color: sideStatus === 'verified' ? 'var(--success)' : sideStatus === 'lost' ? 'var(--danger)' : 'var(--warning)',
                                                    fontWeight: 600
                                                }}
                                            >
                                                <Smartphone size={11} />
                                                <span>Side: {sideStatus.replace('_', ' ')}</span>
                                            </span>
                                        )}
                                    </div>
                                )}

                                {s.cameraPhotos?.length > 0 && <details style={{ padding: '8px 12px', fontSize: 12 }}>
                                    <summary style={{ cursor: 'pointer' }}>Photo history ({s.cameraPhotos.length}) · {isVerified ? 'Verified' : 'Awaiting review'}</summary>
                                    {s.cameraPhotos.slice().reverse().map(photo => <figure key={photo._id || photo.url} style={{ margin: '12px 0' }}>
                                        <img src={assetUrl(photo.url)} alt={`Identity checkpoint for ${s.studentName || s.studentId}`} loading="lazy" style={{ width: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 6 }} />
                                        <figcaption>{new Date(photo.capturedAt).toLocaleString()} · {photo.source} · {photo.status === 'verified' ? 'Verified' : 'Awaiting review'}</figcaption>
                                        {photo.status !== 'verified' && photo._id && <button className="md-btn md-btn-sm md-btn-outlined" disabled={isVerifying} onClick={event => handleConfirmIdentity(sid, event, photo)}>Confirm this photo</button>}
                                    </figure>)}
                                </details>}
                                {/* Action Buttons Footer */}
                                <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', borderTop: '1px solid var(--bg-muted)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                                    {!isLab && !isTerminated && !isCompleted && !isVerified && photoUrl && (
                                        <button 
                                            className="md-btn md-btn-sm"
                                            style={{ flex: 1, fontSize: '11px', padding: '4px 6px', background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid var(--success-soft)' }}
                                            onClick={(e) => handleConfirmIdentity(sid, e)}
                                            disabled={isVerifying}
                                            title="Confirm the latest identity photo"
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

                                    {onOpenChat && <button className="md-btn md-btn-sm md-btn-outlined" onClick={() => onOpenChat(sid)}><MessageSquare size={12} />Chat</button>}
                                    {!isTerminated && !isCompleted && visibleExams.some(exam => matchesExam(exam, s.examId) && exam.examType !== 'physical_lab') && <button className="md-btn md-btn-sm md-btn-outlined" onClick={() => handleRequestPhoto(sid)} disabled={requestingMap[sid] || (s.cameraPhotoRequests || []).some(request => request.source === 'requested' && !request.completedAt)}>
                                        <Camera size={12} />{requestingMap[sid] ? 'Requesting…' : (s.cameraPhotoRequests || []).some(request => request.source === 'requested' && !request.completedAt) ? 'Photo requested' : 'Request new photo'}
                                    </button>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
