import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle, ExternalLink, MessageSquare, Check, X, ShieldAlert, Sparkles, Filter, Video, Users, Smartphone, Eye, Globe } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Components.css';

const API_BASE = 'http://localhost:5000';

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

export default function AlertFeed({ violations, onSelectViolation, onReviewViolation }) {
    const { authFetch } = useAuth();
    const [filter, setFilter] = useState('all'); // 'all', 'unreviewed', 'reviewed'
    const [selectedViolationForNote, setSelectedViolationForNote] = useState(null);
    const [noteText, setNoteText] = useState('');
    const [noteDecision, setNoteDecision] = useState('confirmed');
    const [submitting, setSubmitting] = useState(false);

    const handleQuickReview = async (v, decision, note = '') => {
        const id = v._id || v.id;
        if (!id) return;

        try {
            const res = await authFetch(`${API_BASE}/violations/${id}/review`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reviewed: true,
                    decision: decision,
                    reviewNote: note
                })
            });

            if (res.ok) {
                const data = await res.json();
                if (onReviewViolation) {
                    onReviewViolation(data.violation);
                }
            }
        } catch (err) {
            console.error('Error reviewing violation:', err);
        }
    };

    const handleNoteModalSubmit = async (e) => {
        e.preventDefault();
        if (!selectedViolationForNote) return;

        setSubmitting(true);
        await handleQuickReview(selectedViolationForNote, noteDecision, noteText);
        setSubmitting(false);
        setSelectedViolationForNote(null);
        setNoteText('');
    };

    // Filter violations (exclude dismissed from active live feed)
    const filteredViolations = (violations || []).filter(v => {
        const isReviewed = Boolean(v.reviewed);
        const isDismissed = v.decision === 'dismissed';
        if (filter === 'unreviewed') return !isReviewed && !isDismissed;
        if (filter === 'reviewed') return isReviewed;
        return !isDismissed;
    });

    const unreviewedCount = (violations || []).filter(v => !v.reviewed && v.decision !== 'dismissed').length;

    return (
        <div className="md-card alert-feed-card">
            {/* Header & Filter Bar */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #dadce0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8f9fa' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Filter size={16} style={{ color: '#5f6368' }} />
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#202124' }}>Alert Triage</span>
                    {unreviewedCount > 0 && (
                        <span className="md-badge status-draft" style={{ fontSize: '11px' }}>
                            {unreviewedCount} Needs Review
                        </span>
                    )}
                </div>

                <div className="sub-tabs">
                    <button 
                        className={`sub-tab-btn ${filter === 'all' ? 'active' : ''}`}
                        onClick={() => setFilter('all')}
                    >
                        All
                    </button>
                    <button 
                        className={`sub-tab-btn ${filter === 'unreviewed' ? 'active' : ''}`}
                        onClick={() => setFilter('unreviewed')}
                    >
                        Needs Review ({unreviewedCount})
                    </button>
                    <button 
                        className={`sub-tab-btn ${filter === 'reviewed' ? 'active' : ''}`}
                        onClick={() => setFilter('reviewed')}
                    >
                        Reviewed
                    </button>
                </div>
            </div>

            {/* List Content */}
            {!filteredViolations || filteredViolations.length === 0 ? (
                <div className="md-empty-card" style={{ border: 'none', background: 'transparent', flex: 1 }}>
                    <AlertCircle size={36} className="md-empty-icon" />
                    <p style={{ margin: 0 }}>No {filter === 'all' ? '' : filter} violations recorded.</p>
                </div>
            ) : (
                <div className="alert-items">
                    {filteredViolations.map((v, i) => {
                        const isReviewed = Boolean(v.reviewed);
                        const decision = v.decision || 'pending';

                        return (
                            <div 
                                key={v._id || i} 
                                className={`alert-item alert-severity-${v.severity}`}
                                style={{
                                    opacity: isReviewed ? 0.75 : 1.0,
                                    background: isReviewed ? '#f8f9fa' : '#ffffff',
                                    border: isReviewed ? '1px solid #e8eaed' : '1px solid #1a73e8'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: 600, fontSize: '14px', color: '#202124' }}>
                                            {formatType(v.type)}
                                        </span>
                                        <span className="md-badge" style={{ fontSize: '11px', background: '#f1f3f4', color: '#3c4043' }}>
                                            Sev {v.severity}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '12px', color: '#70757a' }}>{timeAgo(v.timestamp)}</span>
                                        {isReviewed ? (
                                            <span className={`md-badge ${decision === 'confirmed' ? 'status-active' : 'status-completed'}`} style={{ fontSize: '11px' }}>
                                                {decision === 'confirmed' ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                <span style={{ textTransform: 'capitalize' }}>{decision}</span>
                                            </span>
                                        ) : (
                                            <span className="md-badge status-draft" style={{ fontSize: '11px' }}>
                                                <Clock size={12} />
                                                <span>Needs Review</span>
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div style={{ fontSize: '12px', color: '#5f6368', fontFamily: 'monospace', marginBottom: '8px' }}>
                                    Session: {v.sessionId ? (v.sessionId.substring(0, 16) + '...') : 'Unknown'}
                                    {v.details?.object_class && ` • Item: ${v.details.object_class}`}
                                    {v.details?.duration && ` • Duration: ${v.details.duration.toFixed(1)}s`}
                                </div>

                                {v.reviewNote && (
                                    <div style={{ fontSize: '12px', color: '#3c4043', background: '#f1f3f4', padding: '6px 10px', borderRadius: '4px', marginBottom: '8px', fontStyle: 'italic' }}>
                                        Note: "{v.reviewNote}"
                                    </div>
                                )}

                                {/* Quick Action Buttons for Unreviewed Items */}
                                {!isReviewed ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', borderTop: '1px solid #f1f3f4', paddingTop: '8px' }}>
                                        <button 
                                            className="md-btn md-btn-sm" 
                                            style={{ background: '#e6f4ea', color: '#137333', border: '1px solid #a7f3d0' }}
                                            onClick={() => handleQuickReview(v, 'confirmed')}
                                        >
                                            <Check size={14} />
                                            <span>Confirm</span>
                                        </button>

                                        <button 
                                            className="md-btn md-btn-sm" 
                                            style={{ background: '#f1f3f4', color: '#5f6368', border: '1px solid #dadce0' }}
                                            onClick={() => handleQuickReview(v, 'dismissed')}
                                        >
                                            <X size={14} />
                                            <span>Dismiss</span>
                                        </button>

                                        <button 
                                            className="md-btn md-btn-sm md-btn-text"
                                            onClick={() => {
                                                setSelectedViolationForNote(v);
                                                setNoteText(v.reviewNote || '');
                                                setNoteDecision('confirmed');
                                            }}
                                        >
                                            <MessageSquare size={14} />
                                            <span>Note & Review</span>
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                        <button 
                                            className="md-btn md-btn-text md-btn-sm"
                                            style={{ fontSize: '11px', padding: '2px 6px' }}
                                            onClick={() => {
                                                setSelectedViolationForNote(v);
                                                setNoteText(v.reviewNote || '');
                                                setNoteDecision(v.decision || 'confirmed');
                                            }}
                                        >
                                            <span>Edit Decision</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Note & Review Modal */}
            {selectedViolationForNote && (
                <div className="md-modal-overlay">
                    <div className="md-modal-card">
                        <div className="md-modal-header">
                            <h3>Review Violation Alert</h3>
                            <button className="md-icon-btn" onClick={() => setSelectedViolationForNote(null)}>
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleNoteModalSubmit}>
                            <div className="md-form-group">
                                <label>Violation Type</label>
                                <div style={{ fontSize: '14px', fontWeight: 500, color: '#202124' }}>
                                    {formatType(selectedViolationForNote.type)} (Severity {selectedViolationForNote.severity})
                                </div>
                            </div>

                            <div className="md-form-group">
                                <label>Triage Decision *</label>
                                <select 
                                    className="md-select" 
                                    value={noteDecision} 
                                    onChange={(e) => setNoteDecision(e.target.value)}
                                >
                                    <option value="confirmed">Confirm Violation (Valid Infraction)</option>
                                    <option value="dismissed">Dismiss (False Positive / Allowed Exception)</option>
                                </select>
                            </div>

                            <div className="md-form-group">
                                <label>Review Note (Optional)</label>
                                <textarea 
                                    className="md-input" 
                                    rows="3" 
                                    placeholder="Add notes for candidate history (e.g. Candidate looked down to read physical scratch paper)..."
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                ></textarea>
                            </div>

                            <div className="md-modal-actions">
                                <button type="button" className="md-btn md-btn-text" onClick={() => setSelectedViolationForNote(null)}>
                                    Cancel
                                </button>
                                <button type="submit" className="md-btn md-btn-primary" disabled={submitting}>
                                    {submitting ? 'Saving...' : 'Save Decision'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}