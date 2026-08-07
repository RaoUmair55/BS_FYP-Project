import React, { useEffect, useState } from 'react';
import { getViolations } from '../services/api';
import './Components.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function formatType(typeStr) {
    if (!typeStr) return "Unknown";
    return typeStr.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function EvidenceViewer({ sessionId }) {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!sessionId) return;
        setLoading(true);
        getViolations(sessionId)
            .then(res => {
                setHistory(res.data);
                setLoading(false);
            })
            .catch(err => {
                console.error("Error fetching evidence:", err);
                setLoading(false);
            });
    }, [sessionId]);

    if (!sessionId) {
        return (
            <div className="evidence-container">
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    <p>Select a student to view evidence history.</p>
                </div>
            </div>
        );
    }

    if (loading) return <div className="evidence-container"><div className="empty-state">Loading history...</div></div>;

    if (history.length === 0) {
        return (
            <div className="evidence-container">
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p>No violations recorded for this session.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="evidence-container">
            <div className="timeline">
                {history.map(v => (
                    <div key={v._id} className={`timeline-item sev-${v.severity}`}>
                        <div className="timeline-dot"></div>
                        <div className="timeline-content">
                            <div className="timeline-header">
                                <span className="timeline-title">{formatType(v.type)}</span>
                                <span className="timeline-date">{new Date(v.timestamp).toLocaleTimeString()}</span>
                            </div>
                            
                            {v.details && (
                                <div className="evidence-meta mono">
                                    {v.details.confidence && <span>Conf: {Math.round(v.details.confidence * 100)}%</span>}
                                    {v.details.duration && <span>Dur: {v.details.duration}s</span>}
                                    {v.details.object_class && <span>Obj: {v.details.object_class}</span>}
                                </div>
                            )}
                            
                            {v.screenshotPath && (
                                <div className="evidence-image">
                                    <img src={`${API_BASE_URL.replace(/\/$/, '')}/${v.screenshotPath.replace(/^\//, '')}`} alt="Violation evidence" />
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}