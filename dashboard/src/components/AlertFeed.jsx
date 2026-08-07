import React from 'react';
import './Components.css';

function formatType(typeStr) {
    if (!typeStr) return "Unknown";
    return typeStr.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function timeAgo(dateString) {
    const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    if (seconds < 10) return "Just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

export default function AlertFeed({ violations }) {
    if (!violations || violations.length === 0) {
        return (
            <div className="feed-container">
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                    <p>No recent alerts.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="feed-container">
            {violations.map((v, i) => (
                <div key={v._id || i} className={`feed-item severity-${v.severity}`}>
                    <div className="feed-header">
                        <span className="feed-type">{formatType(v.type)}</span>
                        <span className="feed-time">{timeAgo(v.timestamp)}</span>
                    </div>
                    <div className="feed-session mono">Session: {v.sessionId}</div>
                    {v.type === 'unauthorized_app' && v.details?.object_class && (
                        <div className="feed-details">App: {v.details.object_class}</div>
                    )}
                </div>
            ))}
        </div>
    );
}