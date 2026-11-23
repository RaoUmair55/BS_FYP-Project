import React, { useEffect, useState } from 'react';
import { getActiveSessions } from '../services/api';
import RiskScoreBadge from './RiskScoreBadge';
import { Users, Search, AlertCircle, Clock, User, CheckCircle, XCircle } from 'lucide-react';
import './Components.css';

export default function StudentList({ secondaryCameraStatuses = {}, secondaryCameraMeta = {}, riskScores, onSelectStudent, selectedSessionId, examFilter, violations = [] }) {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const formatRemainingTime = (endTimeStr) => {
        if (!endTimeStr) return { text: 'In Lobby', isUrgent: false, isLobby: true };
        const endMs = new Date(endTimeStr).getTime();
        const diffSecs = Math.floor((endMs - currentTime) / 1000);
        if (diffSecs <= 0) return { text: 'Expired', isUrgent: true };
        const mins = Math.floor(diffSecs / 60);
        const secs = diffSecs % 60;
        const isUrgent = mins < 5;
        return { 
            text: isUrgent ? `${mins}m ${secs}s` : `${mins}m left`, 
            isUrgent 
        };
    };

    const fetchSessions = () => {
        getActiveSessions()
            .then(res => {
                setSessions(res.data);
                setLoading(false);
            })
            .catch(err => {
                console.error("Error fetching sessions:", err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchSessions();
        const intervalId = setInterval(fetchSessions, 5000);
        return () => clearInterval(intervalId);
    }, []);

    // Count unreviewed violations per session
    const unreviewedBySession = (violations || []).reduce((acc, v) => {
        if (!v.reviewed && v.sessionId) {
            acc[v.sessionId] = (acc[v.sessionId] || 0) + 1;
        }
        return acc;
    }, {});

    // Filter sessions by selected exam code (if specified) and search query
    const filteredSessions = sessions.filter(s => {
        if (examFilter && s.examId && s.examId.toUpperCase() !== examFilter.toUpperCase()) {
            return false;
        }
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            const sName = (s.studentName || '').toLowerCase();
            const rNum = (s.rollNumber || '').toLowerCase();
            const sid = (s.studentId || '').toLowerCase();
            const eid = (s.examId || '').toLowerCase();
            const sessId = (s.sessionId || s._id || '').toLowerCase();
            return sName.includes(query) || rNum.includes(query) || sid.includes(query) || eid.includes(query) || sessId.includes(query);
        }
        return true;
    });

    // Sort descending by calculated risk score
    const sortedSessions = [...filteredSessions].sort((a, b) => {
        const scoreA = riskScores[a.sessionId || a._id] !== undefined ? riskScores[a.sessionId || a._id] : a.riskScore;
        const scoreB = riskScores[b.sessionId || b._id] !== undefined ? riskScores[b.sessionId || b._id] : b.riskScore;
        return scoreB - scoreA;
    });

    return (
        <div className="md-card student-list-card">
            <div className="student-list-header">
                <div>
                    <h3 style={{ margin: 0 }}>Active Candidates</h3>
                    {examFilter && (
                        <span className="md-badge status-completed" style={{ marginTop: '4px' }}>
                            Exam: {examFilter}
                        </span>
                    )}
                </div>
                <span className="md-badge status-active">
                    <Users size={12} />
                    <span>
                        {sortedSessions.filter(s => s.status === 'active').length} Live
                        {sortedSessions.some(s => s.status === 'terminated') && ` • ${sortedSessions.filter(s => s.status === 'terminated').length} Terminated`}
                    </span>
                </span>
            </div>

            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-muted)', padding: '6px 12px', borderRadius: '6px' }}>
                    <Search size={16} style={{ color: 'var(--text-muted)' }} />
                    <input 
                        type="text" 
                        placeholder="Search student name, roll #, or exam..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '13px', width: '100%', color: 'var(--text-main)' }}
                    />
                </div>
            </div>
            
            {loading ? (
                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="skeleton-card-row">
                            <div className="skeleton-circle" />
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
                                <div className="skeleton-line" style={{ width: '62%', height: '13px' }} />
                                <div className="skeleton-line" style={{ width: '44%', height: '10px' }} />
                            </div>
                            <div className="skeleton-line" style={{ width: '46px', height: '22px', borderRadius: '9999px' }} />
                        </div>
                    ))}
                </div>
            ) : sortedSessions.length === 0 ? (
                <div className="md-empty-card" style={{ border: 'none', background: 'transparent', flex: 1 }}>
                    <Users size={36} className="md-empty-icon" />
                    <p style={{ margin: 0 }}>No active student sessions found.</p>
                </div>
            ) : (
                <div className="student-items">
                    {sortedSessions.map(s => {
                        const sid = s.sessionId || s._id;
                        const currentScore = riskScores[sid] !== undefined ? riskScores[sid] : s.riskScore;
                        const isSelected = selectedSessionId === sid;
                        const pendingAlerts = unreviewedBySession[sid] || 0;
                        const displayName = s.studentName || s.studentId || 'Candidate';
                        const displayRoll = s.rollNumber || s.studentId;
                        const timeInfo = formatRemainingTime(s.endTime);
                        const isTerminated = s.status === 'terminated';
                        const isCompleted = s.status === 'completed';

                        return (
                            <div 
                                key={sid}
                                onClick={() => onSelectStudent(sid)}
                                className={`student-item ${isSelected ? 'selected' : ''}`}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'row',
                                    alignItems: 'flex-start',
                                    gap: '12px',
                                    borderLeft: isTerminated ? '3.5px solid var(--danger)' : isCompleted ? '3.5px solid var(--success)' : isSelected ? '3.5px solid var(--primary)' : undefined,
                                    background: isTerminated ? 'rgba(239, 68, 68, 0.05)' : undefined
                                }}
                            >
                                {/* Candidate Profile Icon Bubble */}
                                <div className="candidate-avatar-bubble" style={{
                                    width: '38px',
                                    height: '38px',
                                    marginTop: '2px',
                                    borderRadius: '50%',
                                    background: isTerminated 
                                        ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(244, 63, 94, 0.35))' 
                                        : isCompleted 
                                        ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.35))' 
                                        : isSelected 
                                        ? 'linear-gradient(135deg, #0ea5e9, #0284c7)' 
                                        : 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(14, 165, 233, 0.25))',
                                    color: isSelected ? '#ffffff' : isTerminated ? 'var(--danger)' : isCompleted ? 'var(--success)' : 'var(--primary)',
                                    border: isSelected ? '1.5px solid #38bdf8' : '1px solid rgba(56, 189, 248, 0.3)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    fontSize: '14px',
                                    flexShrink: 0,
                                    boxShadow: isSelected ? '0 3px 12px rgba(14, 165, 233, 0.4)' : '0 2px 6px rgba(0, 0, 0, 0.05)',
                                    position: 'relative'
                                }}>
                                    <User size={18} strokeWidth={2.2} />
                                    {/* Real-time status ping dot */}
                                    <span style={{
                                        position: 'absolute',
                                        bottom: '0',
                                        right: '0',
                                        width: '9px',
                                        height: '9px',
                                        borderRadius: '50%',
                                        background: isTerminated ? '#f43f5e' : isCompleted ? '#64748b' : '#10b981',
                                        border: '1.5px solid var(--bg-surface)',
                                        boxShadow: isTerminated ? '0 0 6px rgba(244, 63, 94, 0.8)' : isCompleted ? 'none' : '0 0 6px rgba(16, 185, 129, 0.8)'
                                    }} />
                                </div>

                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {/* Top Row: Candidate Name + Risk Score (never crushed by status pills) */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0 }}>
                                        <span
                                            className="student-info-name"
                                            title={displayName}
                                            style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}
                                        >
                                            {displayName}
                                        </span>
                                        <div style={{ flexShrink: 0 }}>
                                            <RiskScoreBadge score={currentScore} />
                                        </div>
                                    </div>

                                    {/* Middle Row: Roll Number & Exam Code */}
                                    <div className="student-info-sub" style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <span style={{ fontWeight: 600 }}>{displayRoll}</span> &bull; {s.examId}
                                        <span title={`Session ID: ${sid}`} style={{ opacity: 0.55, fontSize: '10px', marginLeft: '4px' }}>
                                            ({String(sid).substring(0, 6)}…)
                                        </span>
                                    </div>

                                    {/* Bottom Row: Wrapped Status, Alert Count & Side-Camera Pills */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                        {isTerminated ? (
                                            <span style={{
                                                fontSize: '10.5px',
                                                padding: '2px 7px',
                                                borderRadius: '9999px',
                                                fontWeight: 600,
                                                background: 'var(--danger-soft)',
                                                color: 'var(--danger)',
                                                border: '1px solid rgba(244, 63, 94, 0.35)',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }} title={s.terminationReason || 'Session Terminated'}>
                                                <XCircle size={11} />
                                                <span>Terminated</span>
                                            </span>
                                        ) : isCompleted ? (
                                            <span style={{
                                                fontSize: '10.5px',
                                                padding: '2px 7px',
                                                borderRadius: '9999px',
                                                fontWeight: 600,
                                                background: 'var(--success-soft)',
                                                color: 'var(--success)',
                                                border: '1px solid rgba(16, 185, 129, 0.35)',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                <CheckCircle size={11} />
                                                <span>Submitted</span>
                                            </span>
                                        ) : timeInfo && (
                                            <span style={{
                                                fontSize: '10.5px',
                                                padding: '2px 7px',
                                                borderRadius: '9999px',
                                                fontWeight: 600,
                                                background: timeInfo.isLobby ? 'var(--primary-soft)' : timeInfo.isUrgent ? 'var(--danger-soft)' : 'var(--bg-muted)',
                                                color: timeInfo.isLobby ? 'var(--primary)' : timeInfo.isUrgent ? 'var(--danger)' : 'var(--text-muted)',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                <Clock size={11} />
                                                <span>{timeInfo.text}</span>
                                            </span>
                                        )}

                                        {pendingAlerts > 0 && (
                                            <span className="md-badge status-draft" style={{ fontSize: '10.5px', padding: '2px 7px' }}>
                                                <Clock size={10} />
                                                <span>{pendingAlerts} New</span>
                                            </span>
                                        )}

                                        {(s.requireSecondaryCamera || s.secondaryCamera?.paired || secondaryCameraStatuses[sid]) && (() => {
                                            const sideStatus = secondaryCameraStatuses[sid] || s.secondaryCamera?.status || 'not_paired';
                                            const isFixedStand = Boolean(secondaryCameraMeta[sid]?.fixedStandMode ?? s.secondaryCamera?.fixedStandMode);
                                            const isVerified = sideStatus === 'verified';
                                            const isLost = sideStatus === 'lost';
                                            return (
                                                <span
                                                    className="md-badge"
                                                    role="status"
                                                    title={isFixedStand ? 'Fixed Stand Mode: phone orientation sensor unavailable; using visual drift + AI desk checks.' : undefined}
                                                    style={{
                                                        fontSize: '10.5px',
                                                        padding: '2px 7px',
                                                        background: isLost ? 'var(--danger-soft)' : isVerified ? 'var(--success-soft)' : 'var(--bg-muted)',
                                                        color: isLost ? 'var(--danger)' : isVerified ? 'var(--success)' : 'var(--text-muted)',
                                                        border: isLost ? '1px solid rgba(244,63,94,0.3)' : isVerified ? '1px solid rgba(16,185,129,0.3)' : '1px solid var(--border-color)'
                                                    }}
                                                >
                                                    Side camera: {sideStatus.replace('_', ' ')}{isFixedStand ? ' (fixed stand)' : ''}
                                                </span>
                                            );
                                        })()}
                                    </div>

                                    {isTerminated && s.terminationReason && (
                                        <div style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            Reason: {s.terminationReason}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}