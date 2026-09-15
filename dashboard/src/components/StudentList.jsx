import React, { useEffect, useState } from 'react';
import { getActiveSessions } from '../services/api';
import RiskScoreBadge from './RiskScoreBadge';
import './Components.css';

export default function StudentList({ riskScores, onSelectStudent, selectedSessionId }) {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);

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
        fetchSessions(); // Initial fetch
        const intervalId = setInterval(fetchSessions, 5000); // Poll every 5s
        
        return () => clearInterval(intervalId); // Cleanup
    }, []);

    // Sort descending by calculated current score
    const sortedSessions = [...sessions].sort((a, b) => {
        const scoreA = riskScores[a.sessionId || a._id] !== undefined ? riskScores[a.sessionId || a._id] : a.riskScore;
        const scoreB = riskScores[b.sessionId || b._id] !== undefined ? riskScores[b.sessionId || b._id] : b.riskScore;
        return scoreB - scoreA;
    });

    if (loading) return (
        <div className="student-list-container">
            <div className="empty-state">
                <p>Loading active sessions...</p>
            </div>
        </div>
    );

    return (
        <div className="student-list-container">
            <div className="list-header-panel">
                <h2>Active Sessions</h2>
                <span className="student-count">{sessions.length} student{sessions.length !== 1 ? 's' : ''}</span>
            </div>
            
            {sessions.length === 0 ? (
                <div className="empty-state" style={{borderTop: 'none', borderRadius: 0, flex: 1}}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                    <p>No active sessions detected.</p>
                </div>
            ) : (
                <div className="student-table-wrapper">
                    <table className="student-table">
                        <thead>
                            <tr>
                                <th>Student ID</th>
                                <th>Exam ID</th>
                                <th style={{textAlign: 'right'}}>Risk Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedSessions.map(s => {
                                const sid = s.sessionId || s._id;
                                const currentScore = riskScores[sid] !== undefined ? riskScores[sid] : s.riskScore;
                                return (
                                    <tr 
                                        key={sid} 
                                        onClick={() => onSelectStudent(sid)}
                                        className={selectedSessionId === sid ? 'selected' : ''}
                                    >
                                        <td className="mono">{s.studentId}</td>
                                        <td className="mono">{s.examId}</td>
                                        <td style={{textAlign: 'right'}}>
                                            <RiskScoreBadge score={currentScore} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}