import React, { useEffect, useState } from 'react';
import { getActiveSessions } from '../services/api';
import RiskScoreBadge from './RiskScoreBadge';
import { Users, Search, AlertCircle, Clock } from 'lucide-react';
import './Components.css';

export default function StudentList({ riskScores, onSelectStudent, selectedSessionId, examFilter, violations = [] }) {
    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const formatRemainingTime = (endTimeStr) => {
        if (!endTimeStr) return null;
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
                    <span>{sortedSessions.length} Live</span>
                </span>
            </div>

            <div style={{ padding: '8px 16px', borderBottom: '1px solid #dadce0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f1f3f4', padding: '6px 12px', borderRadius: '6px' }}>
                    <Search size={16} style={{ color: '#5f6368' }} />
                    <input 
                        type="text" 
                        placeholder="Search student name, roll #, or exam..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '13px', width: '100%' }}
                    />
                </div>
            </div>
            
            {loading ? (
                <div className="md-loading" style={{ padding: '24px' }}>Loading active sessions...</div>
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

                        return (
                            <div 
                                key={sid}
                                onClick={() => onSelectStudent(sid)}
                                className={`student-item ${isSelected ? 'selected' : ''}`}
                            >
                                <div style={{ overflow: 'hidden' }}>
                                    <div className="student-info-name" style={{ fontWeight: 600, fontSize: '13.5px', color: '#202124', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span>{displayName}</span>
                                        {timeInfo && (
                                            <span style={{
                                                fontSize: '10px',
                                                padding: '1px 5px',
                                                borderRadius: '8px',
                                                fontWeight: 600,
                                                background: timeInfo.isUrgent ? '#fee2e2' : '#f1f5f9',
                                                color: timeInfo.isUrgent ? '#b91c1c' : '#475569'
                                            }}>
                                                ⏱️ {timeInfo.text}
                                            </span>
                                        )}
                                    </div>
                                    <div className="student-info-sub" style={{ fontSize: '11.5px', color: '#5f6368', marginTop: '2px' }}>
                                        <span style={{ fontWeight: 500 }}>{displayRoll}</span> &bull; Exam: {s.examId}
                                        <span title={`Session ID: ${sid}`} style={{ opacity: 0.5, fontSize: '10px', marginLeft: '4px' }}>
                                            ({String(sid).substring(0, 6)}...)
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {pendingAlerts > 0 && (
                                        <span className="md-badge status-draft" style={{ fontSize: '11px', padding: '2px 6px' }}>
                                            <Clock size={10} />
                                            <span>{pendingAlerts} New</span>
                                        </span>
                                    )}
                                    <RiskScoreBadge score={currentScore} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}