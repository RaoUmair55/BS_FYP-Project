import React, { useState, useMemo } from 'react';
import { 
    AlertCircle, AlertTriangle, Info, CheckCircle, XCircle, Clock, 
    ExternalLink, MessageSquare, Check, X, ShieldAlert, Sparkles, 
    Filter, Video, Users, Smartphone, Eye, Globe, Layers, ChevronDown, ChevronUp, Volume2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { assetUrl } from '../services/api';
import { groupViolationsList } from './PriorityQueue';
import './Components.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

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
    if (typeStr === 'second_voice_detected') {
        const sim = details?.similarity_score !== undefined ? ` (${Math.round(details.similarity_score * 100)}% match)` : '';
        return `🎙️ Second Voice Detected${sim}`;
    }
    if (typeStr === 'no_face_detected') {
        return "No Face in View";
    }
    if (typeStr === 'pre_existing_file' || (typeStr === 'unauthorized_app' && (details?.reason?.toLowerCase().includes('pre-existing') || details?.fileName))) {
        const fileTarget = details?.fileName || (details?.reason ? details.reason.split(':').pop().trim() : '');
        const appName = details?.object_class ? ` in ${details.object_class}` : '';
        return fileTarget ? `📂 Pre-Existing File: ${fileTarget}${appName}` : `📂 Pre-Existing Notes/File Opened${appName}`;
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

export default function AlertFeed({ violations, onSelectViolation, onReviewViolation, examFilter }) {
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
            if (examFilter && String(v.examId || '').toUpperCase() !== String(examFilter).toUpperCase()) return false;
            const isReviewed = Boolean(v.reviewed);
            const isDismissed = v.decision === 'dismissed';
            if (filter === 'unreviewed') return !isReviewed && !isDismissed;
            if (filter === 'reviewed') return isReviewed;
            return !isDismissed;
        });
    }, [violations, filter, examFilter]);

    // Apply Client-Side 2-Minute Grouping
    const displayItems = useMemo(() => {
        if (!enableGrouping) return filteredViolations.map(v => ({ ...v, count: 1, items: [v] }));
        return groupViolationsList(filteredViolations, 2 * 60 * 1000);
    }, [filteredViolations, enableGrouping]);

    const unreviewedCount = filteredViolations.filter(v => !v.reviewed && v.decision !== 'dismissed').length;

    return (
        <div className="md-card alert-feed-card">
            {/* Header & Filter Bar */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-base)', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Filter size={16} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-main)' }}>Alert Triage</span>
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
                                    background: isReviewed ? 'var(--bg-base)' : 'var(--bg-surface)',
                                    border: isReviewed ? '1px solid var(--border-color)' : '1px solid var(--primary)'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>
                                            {formatType(group.type, group.details)}
                                        </span>
                                        {isGrouped && (
                                            <span style={{
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                color: 'var(--warning)',
                                                backgroundColor: 'var(--warning-soft)',
                                                border: '1px solid var(--warning-soft)',
                                                padding: '2px 6px',
                                                borderRadius: '10px'
                                            }}>
                                                {group.count}× in 2m
                                            </span>
                                        )}
                                        <span className="md-badge alert-severity-badge" style={{ fontSize: '11px', background: 'var(--bg-muted)', color: 'var(--text-main)' }}>
                                            Sev {group.severity}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{timeAgo(group.timestamp)}</span>
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

                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: '8px' }}>
                                    Session: {group.sessionId ? (group.sessionId.substring(0, 16) + '...') : 'Unknown'}
                                    {group.details?.object_class && ` • App: ${group.details.object_class}`}
                                    {group.details?.fileName && ` • File: ${group.details.fileName}`}
                                    {group.details?.duration && ` • Duration: ${group.details.duration.toFixed(1)}s`}
                                </div>

                                {group.details?.reason && (
                                    <div style={{
                                        fontSize: '12px',
                                        color: 'var(--warning)',
                                        backgroundColor: 'var(--warning-soft)',
                                        border: '1px solid var(--warning-soft)',
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        marginBottom: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}>
                                        <span>⚠️</span>
                                        <strong>{group.details.reason}</strong>
                                    </div>
                                )}

                                {(group.audioPath || group.details?.audioPath) && (
                                    <div 
                                        style={{ 
                                            marginTop: '6px', 
                                            marginBottom: '8px', 
                                            padding: '8px 10px', 
                                            borderRadius: '6px', 
                                            background: 'rgba(13, 148, 136, 0.08)', 
                                            border: '1px solid rgba(13, 148, 136, 0.3)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '4px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 600, color: '#0d9488' }}>
                                                <Volume2 size={13} />
                                                <span>Recorded Voice Audio Clip</span>
                                            </div>
                                            {group.details?.similarity_score !== undefined && (
                                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                                                    Match: {Math.round(group.details.similarity_score * 100)}%
                                                </span>
                                            )}
                                        </div>
                                        <audio 
                                            controls 
                                            src={assetUrl(group.audioPath || group.details.audioPath)} 
                                            style={{ width: '100%', height: '32px', outline: 'none' }}
                                        />
                                    </div>
                                )}

                                {group.screenshotPath && (
                                    <div 
                                        style={{ 
                                            marginTop: '6px', 
                                            marginBottom: '8px', 
                                            borderRadius: '6px', 
                                            overflow: 'hidden', 
                                            border: '1px solid var(--border-color)',
                                            maxHeight: '180px', 
                                            background: '#0f172a',
                                            cursor: onSelectViolation ? 'pointer' : 'default'
                                        }}
                                        onClick={() => onSelectViolation && onSelectViolation(group)}
                                        title={onSelectViolation ? "Click to open candidate Evidence Review" : "Violation screenshot"}
                                    >
                                        <img 
                                            src={assetUrl(group.screenshotPath.startsWith('http://') || group.screenshotPath.startsWith('https://')
                                                ? group.screenshotPath 
                                                : `${API_BASE.replace(/\/$/, '')}/${group.screenshotPath.replace(/^\//, '')}`)}
                                            alt="Alert Evidence Snapshot" 
                                            style={{ width: '100%', maxHeight: '180px', objectFit: 'contain', display: 'block' }} 
                                        />
                                    </div>
                                )}

                                {group.reviewNote && (
                                    <div style={{ fontSize: '12px', color: 'var(--text-main)', background: 'var(--bg-muted)', padding: '6px 10px', borderRadius: '4px', marginBottom: '8px', fontStyle: 'italic' }}>
                                        Note: "{group.reviewNote}"
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: '8px', borderTop: '1px solid var(--bg-muted)', paddingTop: '8px' }}>
                                    {!isReviewed ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <button 
                                                className="md-btn md-btn-sm" 
                                                style={{ background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid #a7f3d0' }}
                                                onClick={() => handleQuickReview(group, 'confirmed')}
                                            >
                                                <Check size={14} />
                                                <span>Confirm {isGrouped ? `(${group.count})` : ''}</span>
                                            </button>

                                            <button 
                                                className="md-btn md-btn-sm" 
                                                style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
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
                                        borderTop: '1px dashed var(--border-color)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '6px',
                                        background: 'var(--bg-base)',
                                        padding: '8px 12px',
                                        borderRadius: '6px'
                                    }}>
                                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
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
                                                    borderBottom: idx < group.items.length - 1 ? '1px solid var(--border-color)' : 'none'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>#{idx + 1}</span>
                                                    <Clock size={12} color="var(--text-muted)" />
                                                    <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                                                    {item.details?.confidence && (
                                                        <span style={{ color: 'var(--text-muted)' }}>({(item.details.confidence * 100).toFixed(0)}% conf)</span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {(item.audioPath || item.details?.audioPath) && (
                                                        <a 
                                                            href={assetUrl(item.audioPath || item.details.audioPath)}
                                                            target="_blank" 
                                                            rel="noreferrer"
                                                            style={{ color: '#0d9488', textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '3px' }}
                                                            title="Listen to audio clip"
                                                        >
                                                            <Volume2 size={12} />
                                                            <span>Audio</span>
                                                        </a>
                                                    )}
                                                    {item.screenshotPath && (
                                                        <a 
                                                            href={assetUrl(item.screenshotPath.startsWith('http') ? item.screenshotPath : `${API_BASE}${item.screenshotPath}`)}
                                                            target="_blank" 
                                                            rel="noreferrer"
                                                            style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '2px' }}
                                                        >
                                                            <ExternalLink size={11} />
                                                            <span>Snapshot</span>
                                                        </a>
                                                    )}
                                                    <button
                                                        className="md-btn md-btn-sm"
                                                        style={{ padding: '2px 6px', fontSize: '11px', background: 'var(--success-soft)', color: 'var(--success)', border: 'none' }}
                                                        onClick={() => handleQuickReview(item, 'confirmed')}
                                                    >
                                                        Confirm
                                                    </button>
                                                    <button
                                                        className="md-btn md-btn-sm"
                                                        style={{ padding: '2px 6px', fontSize: '11px', background: 'var(--bg-muted)', color: 'var(--text-muted)', border: 'none' }}
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
                                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-main)' }}>
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
