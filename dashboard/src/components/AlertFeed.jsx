import React, { useState, useMemo } from 'react';
import { 
    AlertCircle, AlertTriangle, Info, CheckCircle, XCircle, Clock, 
    ExternalLink, MessageSquare, Check, X, ShieldAlert, Sparkles, 
    Filter, Video, Users, Smartphone, Eye, Globe, Layers, ChevronDown, ChevronUp 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { groupViolationsList } from './PriorityQueue';
import './Components.css';

const API_BASE = 'http://localhost:5000';

function formatType(typeStr, details = {}) {
    if (!typeStr) return "Unknown";
    if (typeStr === 'head_turn_away') {
        if (details?.reason) return details.reason;
        if (details?.direction === 'left') return "Looking Left";
        if (details?.direction === 'right') return "Looking Right";
        if (details?.direction === 'down') return "Looking Down (Desk Gaze)";
        return "Head Turn Away";
    }
    if (typeStr === 'unauthorized_object') {
        if (details?.object_class) {
            return `Unauthorized ${details.object_class.charAt(0).toUpperCase() + details.object_class.slice(1)}`;
        }
        return "Unauthorized Object";
    }
    if (typeStr === 'second_person_detected') {
        return "Second Person Detected";
    }
    if (typeStr === 'no_face_detected') {
        return "No Face in View";
    }
    if (typeStr === 'unauthorized_app') {
        if (details?.object_class) {
            return `Unauthorized App (${details.object_class})`;
        }
        return "Unauthorized Application";
    }
    if (typeStr === 'camera_occluded_or_dark') {
        return "Camera Occluded / Feed Dark";
    }
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
    const [enableGrouping, setEnableGrouping] = useState(true);
    const [expandedGroupIds, setExpandedGroupIds] = useState(new Set());
    const [selectedViolationForNote, setSelectedViolationForNote] = useState(null);
    const [noteText, setNoteText] = useState('');
    const [noteDecision, setNoteDecision] = useState('confirmed');
    const [submitting, setSubmitting] = useState(false);

    const toggleGroupExpand = (groupId) => {
        setExpandedGroupIds(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    const handleQuickReview = async (vOrGroup, decision, note = '') => {
        const items = vOrGroup.items || [vOrGroup];
        
        try {
            await Promise.all(items.map(async (item) => {
                const id = item._id || item.id;
                if (!id) return;
                const res = await authFetch(`${API_BASE}/violations/${id}/review`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        reviewed: true,
                        decision: decision,
                        reviewNote: note
                    })
                });
                if (res.ok && onReviewViolation) {
                    const data = await res.json();
                    onReviewViolation(data.violation || item);
                }
            }));
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
    const filteredViolations = useMemo(() => {
        return (violations || []).filter(v => {
            const isReviewed = Boolean(v.reviewed);
            const isDismissed = v.decision === 'dismissed';
            if (filter === 'unreviewed') return !isReviewed && !isDismissed;
            if (filter === 'reviewed') return isReviewed;
            return !isDismissed;
        });
    }, [violations, filter]);

    // Apply Client-Side 2-Minute Grouping
    const displayItems = useMemo(() => {
        if (!enableGrouping) return filteredViolations.map(v => ({ ...v, count: 1, items: [v] }));
        return groupViolationsList(filteredViolations, 2 * 60 * 1000);
    }, [filteredViolations, enableGrouping]);

    const unreviewedCount = (violations || []).filter(v => !v.reviewed && v.decision !== 'dismissed').length;

    return (
        <div className="md-card alert-feed-card">
            {/* Header & Filter Bar */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #dadce0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8f9fa', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Filter size={16} style={{ color: '#5f6368' }} />
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#202124' }}>Alert Triage</span>
                    {unreviewedCount > 0 && (
                        <span className="md-badge status-draft" style={{ fontSize: '11px' }}>
                            {unreviewedCount} Needs Review
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {/* 2-Min Grouping Toggle */}
                    <button
                        type="button"
                        onClick={() => setEnableGrouping(!enableGrouping)}
                        className={`md-btn md-btn-sm ${enableGrouping ? 'md-btn-primary' : 'md-btn-outlined'}`}
                        style={{ fontSize: '11.5px', padding: '4px 8px' }}
                        title="Collapse consecutive alerts of the same type within 2 minutes"
                    >
                        <Layers size={13} />
                        <span>{enableGrouping ? '2m Grouping: ON' : 'Grouping: OFF'}</span>
                    </button>

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
            </div>

            {/* List Content */}
            {!displayItems || displayItems.length === 0 ? (
                <div className="md-empty-card" style={{ border: 'none', background: 'transparent', flex: 1 }}>
                    <AlertCircle size={36} className="md-empty-icon" />
                    <p style={{ margin: 0 }}>No {filter === 'all' ? '' : filter} violations recorded.</p>
                </div>
            ) : (
                <div className="alert-items">
                    {displayItems.map((group, i) => {
                        const isReviewed = Boolean(group.reviewed);
                        const decision = group.decision || 'pending';
                        const isGrouped = group.count > 1;
                        const isExpanded = expandedGroupIds.has(group._id);

                        return (
                            <div 
                                key={group._id || i} 
                                className={`alert-item alert-severity-${group.severity}`}
                                style={{
                                    opacity: isReviewed ? 0.75 : 1.0,
                                    background: isReviewed ? '#f8f9fa' : '#ffffff',
                                    border: isReviewed ? '1px solid #e8eaed' : '1px solid #1a73e8'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 600, fontSize: '14px', color: '#202124' }}>
                                            {formatType(group.type, group.details)}
                                        </span>
                                        {isGrouped && (
                                            <span style={{
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                color: '#b45309',
                                                backgroundColor: '#fef7e0',
                                                border: '1px solid #ffeeba',
                                                padding: '2px 6px',
                                                borderRadius: '10px'
                                            }}>
                                                {group.count}× in 2m
                                            </span>
                                        )}
                                        <span className="md-badge" style={{ fontSize: '11px', background: '#f1f3f4', color: '#3c4043' }}>
                                            Sev {group.severity}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '12px', color: '#70757a' }}>{timeAgo(group.timestamp)}</span>
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
                                    Session: {group.sessionId ? (group.sessionId.substring(0, 16) + '...') : 'Unknown'}
                                    {group.details?.object_class && ` • Item: ${group.details.object_class}`}
                                    {group.details?.duration && ` • Duration: ${group.details.duration.toFixed(1)}s`}
                                </div>

                                {group.screenshotPath && (
                                    <div 
                                        style={{ 
                                            marginTop: '6px', 
                                            marginBottom: '8px', 
                                            borderRadius: '6px', 
                                            overflow: 'hidden', 
                                            border: '1px solid #dadce0', 
                                            maxHeight: '180px', 
                                            background: '#0f172a',
                                            cursor: onSelectViolation ? 'pointer' : 'default'
                                        }}
                                        onClick={() => onSelectViolation && onSelectViolation(group)}
                                        title={onSelectViolation ? "Click to open candidate Evidence Review" : "Violation screenshot"}
                                    >
                                        <img 
                                            src={group.screenshotPath.startsWith('http://') || group.screenshotPath.startsWith('https://') 
                                                ? group.screenshotPath 
                                                : `${API_BASE.replace(/\/$/, '')}/${group.screenshotPath.replace(/^\//, '')}`} 
                                            alt="Alert Evidence Snapshot" 
                                            style={{ width: '100%', maxHeight: '180px', objectFit: 'contain', display: 'block' }} 
                                        />
                                    </div>
                                )}

                                {group.reviewNote && (
                                    <div style={{ fontSize: '12px', color: '#3c4043', background: '#f1f3f4', padding: '6px 10px', borderRadius: '4px', marginBottom: '8px', fontStyle: 'italic' }}>
                                        Note: "{group.reviewNote}"
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: '8px', borderTop: '1px solid #f1f3f4', paddingTop: '8px' }}>
                                    {!isReviewed ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <button 
                                                className="md-btn md-btn-sm" 
                                                style={{ background: '#e6f4ea', color: '#137333', border: '1px solid #a7f3d0' }}
                                                onClick={() => handleQuickReview(group, 'confirmed')}
                                            >
                                                <Check size={14} />
                                                <span>Confirm {isGrouped ? `(${group.count})` : ''}</span>
                                            </button>

                                            <button 
                                                className="md-btn md-btn-sm" 
                                                style={{ background: '#f1f3f4', color: '#5f6368', border: '1px solid #dadce0' }}
                                                onClick={() => handleQuickReview(group, 'dismissed')}
                                            >
                                                <X size={14} />
                                                <span>Dismiss {isGrouped ? `(${group.count})` : ''}</span>
                                            </button>

                                            <button 
                                                className="md-btn md-btn-sm md-btn-text"
                                                onClick={() => {
                                                    setSelectedViolationForNote(group);
                                                    setNoteText(group.reviewNote || '');
                                                    setNoteDecision('confirmed');
                                                }}
                                            >
                                                <MessageSquare size={14} />
                                                <span>Note</span>
                                            </button>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <button 
                                                className="md-btn md-btn-text md-btn-sm"
                                                style={{ fontSize: '11px', padding: '2px 6px' }}
                                                onClick={() => {
                                                    setSelectedViolationForNote(group);
                                                    setNoteText(group.reviewNote || '');
                                                    setNoteDecision(group.decision || 'confirmed');
                                                }}
                                            >
                                                <span>Edit Decision</span>
                                            </button>
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                                        {isGrouped && (
                                            <button
                                                type="button"
                                                onClick={() => toggleGroupExpand(group._id)}
                                                className="md-btn md-btn-outlined md-btn-sm"
                                                style={{ fontSize: '11px', padding: '3px 8px' }}
                                                title={isExpanded ? "Collapse instances" : "Expand all instances"}
                                            >
                                                <span>{isExpanded ? "Collapse" : `Expand (${group.count})`}</span>
                                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                            </button>
                                        )}

                                        {onSelectViolation && group.sessionId && (
                                            <button 
                                                className="md-btn md-btn-sm md-btn-outlined"
                                                style={{ fontSize: '11px', padding: '3px 8px' }}
                                                onClick={() => onSelectViolation(group)}
                                                title="Open candidate evidence timeline"
                                            >
                                                <Eye size={12} />
                                                <span>Review Candidate</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Expanded Nested Instances */}
                                {isGrouped && isExpanded && (
                                    <div style={{
                                        marginTop: '10px',
                                        paddingTop: '10px',
                                        borderTop: '1px dashed #dadce0',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '6px',
                                        background: '#f8f9fa',
                                        padding: '8px 12px',
                                        borderRadius: '6px'
                                    }}>
                                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#5f6368', textTransform: 'uppercase' }}>
                                            Grouped Instances ({group.items.length})
                                        </span>
                                        {group.items.map((item, idx) => (
                                            <div 
                                                key={item._id || item.id || idx}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    fontSize: '12px',
                                                    padding: '4px 0',
                                                    borderBottom: idx < group.items.length - 1 ? '1px solid #e8eaed' : 'none'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontWeight: 600, color: '#5f6368' }}>#{idx + 1}</span>
                                                    <Clock size={12} color="#5f6368" />
                                                    <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                                                    {item.details?.confidence && (
                                                        <span style={{ color: '#5f6368' }}>({(item.details.confidence * 100).toFixed(0)}% conf)</span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {item.screenshotPath && (
                                                        <a 
                                                            href={item.screenshotPath.startsWith('http') ? item.screenshotPath : `${API_BASE}${item.screenshotPath}`}
                                                            target="_blank" 
                                                            rel="noreferrer"
                                                            style={{ color: '#1a73e8', textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '2px' }}
                                                        >
                                                            <ExternalLink size={11} />
                                                            <span>Snapshot</span>
                                                        </a>
                                                    )}
                                                    <button
                                                        className="md-btn md-btn-sm"
                                                        style={{ padding: '2px 6px', fontSize: '11px', background: '#e6f4ea', color: '#137333', border: 'none' }}
                                                        onClick={() => handleQuickReview(item, 'confirmed')}
                                                    >
                                                        Confirm
                                                    </button>
                                                    <button
                                                        className="md-btn md-btn-sm"
                                                        style={{ padding: '2px 6px', fontSize: '11px', background: '#f1f3f4', color: '#5f6368', border: 'none' }}
                                                        onClick={() => handleQuickReview(item, 'dismissed')}
                                                    >
                                                        Dismiss
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
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