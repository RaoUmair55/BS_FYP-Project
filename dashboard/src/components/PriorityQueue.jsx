import React, { useState, useEffect, useMemo } from 'react';
import { 
    AlertCircle, AlertTriangle, ShieldAlert, Check, X, 
    Clock, ExternalLink, MessageSquare, ChevronDown, 
    ChevronUp, Filter, User, Layers, RefreshCw, Zap,
    Image, Eye, Smartphone, Users, Globe, Maximize2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
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

function getCategoryInfo(typeStr, details = {}) {
    if (!typeStr) return { label: 'General Alert', icon: '⚠️', color: '#5f6368', badgeBg: '#f1f3f4' };
    if (typeStr.includes('object') || typeStr.includes('phone') || details?.object_class) {
        const item = details?.object_class ? details.object_class.toLowerCase() : 'Mobile / Object';
        return { 
            label: `📱 ${item.charAt(0).toUpperCase() + item.slice(1)}`, 
            icon: '📱', 
            color: '#b91c1c', 
            badgeBg: '#fee2e2' 
        };
    }
    if (typeStr.includes('head') || typeStr.includes('turn') || typeStr.includes('gaze')) {
        return { label: '👤 Head / Gaze Turn', icon: '👤', color: '#b45309', badgeBg: '#fef3c7' };
    }
    if (typeStr.includes('second_person') || typeStr.includes('multiple_faces')) {
        return { label: '👥 Second Person', icon: '👥', color: '#b91c1c', badgeBg: '#fee2e2' };
    }
    if (typeStr.includes('no_face')) {
        return { label: '👁️ Face Missing', icon: '👁️', color: '#c2410c', badgeBg: '#ffedd5' };
    }
    if (typeStr.includes('app') || typeStr.includes('window')) {
        return { label: '🖥️ App Switch', icon: '🖥️', color: '#4338ca', badgeBg: '#e0e7ff' };
    }
    if (typeStr.includes('camera') || typeStr.includes('dark')) {
        return { label: '🌑 Camera Feed Dark', icon: '🌑', color: '#4b5563', badgeBg: '#f3f4f6' };
    }
    return { label: '⚠️ Suspicious Activity', icon: '⚠️', color: '#b45309', badgeBg: '#fef3c7' };
}

function timeAgo(dateString) {
    const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    if (seconds < 10) return "Just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

// Client-side 2-minute grouping of repeated same-student, same-type violations
export function groupViolationsList(violations = [], timeWindowMs = 2 * 60 * 1000) {
    if (!violations || violations.length === 0) return [];
    
    const getTimeMs = (ts) => {
        if (!ts) return Date.now();
        if (typeof ts === 'number') return ts < 1e11 ? ts * 1000 : ts;
        const ms = new Date(ts).getTime();
        return isNaN(ms) ? Date.now() : ms;
    };

    const getSessionId = (v) => {
        return String(v.sessionId?._id || v.sessionId || v.studentName || 'unknown');
    };

    const getType = (v) => {
        return String(v.type || 'unknown');
    };

    const groups = [];
    
    for (let i = 0; i < violations.length; i++) {
        const v = violations[i];
        const vTime = getTimeMs(v.timestamp);
        const vSession = getSessionId(v);
        const vType = getType(v);
        
        // Find existing group for the same student and violation type within the sliding time window
        const matchingGroup = groups.find(g => {
            if (g.sessionId !== vSession) return false;
            if (g.type !== vType) return false;
            const minTime = g.minItemTime ?? g.lastItemTime;
            const maxTime = g.maxItemTime ?? g.lastItemTime;
            return (
                Math.abs(minTime - vTime) <= timeWindowMs ||
                Math.abs(maxTime - vTime) <= timeWindowMs ||
                (vTime >= minTime && vTime <= maxTime)
            );
        });

        if (matchingGroup) {
            matchingGroup.items.push(v);
            matchingGroup.count = matchingGroup.items.length;
            matchingGroup.minItemTime = Math.min(matchingGroup.minItemTime ?? vTime, vTime);
            matchingGroup.maxItemTime = Math.max(matchingGroup.maxItemTime ?? vTime, vTime);
            matchingGroup.lastItemTime = matchingGroup.maxItemTime;
            
            // Keep the highest severity in the group
            if (Number(v.severity) > Number(matchingGroup.severity)) {
                matchingGroup.severity = v.severity;
            }
            // Keep the latest timestamp and snapshot for display
            if (vTime >= getTimeMs(matchingGroup.timestamp)) {
                matchingGroup.timestamp = v.timestamp;
                if (v.details) matchingGroup.details = v.details;
                if (v.screenshotPath) matchingGroup.screenshotPath = v.screenshotPath;
                if (v.evidenceUrl) matchingGroup.evidenceUrl = v.evidenceUrl;
            }
            // If any item is unreviewed, mark the group as needing review
            if (!v.reviewed) {
                matchingGroup.reviewed = false;
                matchingGroup.decision = 'pending';
            }
        } else {
            groups.push({
                _id: v._id || v.id || `group-${i}-${Date.now()}`,
                id: v._id || v.id || `group-${i}-${Date.now()}`,
                sessionId: vSession,
                studentName: v.studentName || 'Candidate',
                rollNumber: v.rollNumber || 'N/A',
                examId: v.examId || 'Unknown',
                type: vType,
                severity: v.severity,
                timestamp: v.timestamp,
                details: v.details,
                screenshotPath: v.screenshotPath,
                evidenceUrl: v.evidenceUrl,
                reviewed: v.reviewed,
                decision: v.decision || 'pending',
                reviewNote: v.reviewNote,
                count: 1,
                minItemTime: vTime,
                maxItemTime: vTime,
                lastItemTime: vTime,
                items: [v]
            });
        }
    }
    
    return groups;
}

export default function PriorityQueue({ socket, examFilter, onSelectExamFilter, onSelectStudentForReview }) {
    const { authFetch } = useAuth();
    const [queueData, setQueueData] = useState([]);
    const [activeExams, setActiveExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedExam, setSelectedExam] = useState(examFilter || 'ALL');
    const [severityFilter, setSeverityFilter] = useState('all'); // 'all', 'high', 'medium', 'low'
    const [enableGrouping, setEnableGrouping] = useState(true);
    
    // Collapsible Dropdown States
    const [expandedGroupIds, setExpandedGroupIds] = useState(new Set());
    const [expandedEvidenceIds, setExpandedEvidenceIds] = useState(new Set());
    const [modalImageSrc, setModalImageSrc] = useState(null);
    
    // Review Note Modal State
    const [selectedViolationForNote, setSelectedViolationForNote] = useState(null);
    const [noteText, setNoteText] = useState('');
    const [noteDecision, setNoteDecision] = useState('confirmed');
    const [submitting, setSubmitting] = useState(false);

    // Sync selectedExam if parent examFilter changes
    useEffect(() => {
        if (examFilter) {
            setSelectedExam(examFilter);
        }
    }, [examFilter]);

    // Fetch active exams for selector
    useEffect(() => {
        const fetchActiveExams = async () => {
            try {
                const res = await authFetch(`${API_BASE}/exams?status=active`);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        setActiveExams(data);
                    }
                }
            } catch (e) {
                // Non-critical fallback
            }
        };
        fetchActiveExams();
    }, []);

    // Initial / Scoped Fetch of Priority Queue
    const fetchPriorityQueue = async () => {
        try {
            setLoading(true);
            const url = selectedExam && selectedExam !== 'ALL'
                ? `${API_BASE}/violations/priority-queue?examId=${encodeURIComponent(selectedExam)}`
                : `${API_BASE}/violations/priority-queue`;

            const res = await authFetch(url);
            if (res.ok) {
                const data = await res.json();
                setQueueData(data);
            }
        } catch (err) {
            console.error('Failed to load priority queue:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPriorityQueue();
    }, [selectedExam]);

    // Live Socket Updates
    useEffect(() => {
        if (!socket) return;

        const handleNewViolation = (violation) => {
            if (violation.reviewed) return;
            // If scoped to an exam, ignore violations for other exams
            if (selectedExam && selectedExam !== 'ALL' && violation.examId && violation.examId !== selectedExam) {
                return;
            }

            setQueueData(prev => {
                const id = violation._id || violation.id;
                const existingIndex = prev.findIndex(v => (v._id || v.id) === id);
                let updatedList;
                if (existingIndex >= 0) {
                    updatedList = [...prev];
                    updatedList[existingIndex] = { ...updatedList[existingIndex], ...violation };
                } else {
                    updatedList = [violation, ...prev];
                }
                // Maintain severity descending, then timestamp descending
                return updatedList.sort((a, b) => {
                    if (b.severity !== a.severity) return b.severity - a.severity;
                    return new Date(b.timestamp) - new Date(a.timestamp);
                });
            });
        };

        const handleViolationReviewed = (reviewData) => {
            const targetId = String(reviewData.violationId || reviewData._id || reviewData.id);
            setQueueData(prev => prev.filter(v => String(v._id || v.id) !== targetId));
        };

        socket.on('violation', handleNewViolation);
        socket.on('violationReviewed', handleViolationReviewed);

        return () => {
            socket.off('violation', handleNewViolation);
            socket.off('violationReviewed', handleViolationReviewed);
        };
    }, [socket, selectedExam]);

    const toggleGroupExpand = (groupId) => {
        setExpandedGroupIds(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    };

    const toggleEvidenceExpand = (groupId) => {
        setExpandedEvidenceIds(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    };

    const handleQuickReview = async (groupOrViolation, decision, note = '') => {
        const itemsToReview = groupOrViolation.items || [groupOrViolation];
        
        try {
            await Promise.all(itemsToReview.map(item => {
                const id = item._id || item.id;
                if (!id) return Promise.resolve();
                return authFetch(`${API_BASE}/violations/${id}/review`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        reviewed: true,
                        decision: decision,
                        reviewNote: note
                    })
                });
            }));

            // Remove reviewed items from local state
            const reviewedIds = new Set(itemsToReview.map(i => String(i._id || i.id)));
            setQueueData(prev => prev.filter(v => !reviewedIds.has(String(v._id || v.id))));
        } catch (err) {
            console.error('Error reviewing priority queue item:', err);
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

    // Filter by Exam & Severity
    const filteredQueue = useMemo(() => {
        return queueData.filter(v => {
            if (selectedExam && selectedExam !== 'ALL' && v.examId && v.examId !== selectedExam) {
                return false;
            }
            if (severityFilter === 'high') return v.severity >= 4;
            if (severityFilter === 'medium') return v.severity === 3;
            if (severityFilter === 'low') return v.severity <= 2;
            return true;
        });
    }, [queueData, selectedExam, severityFilter]);

    // Apply Client-Side 2-Minute Grouping
    const displayItems = useMemo(() => {
        if (!enableGrouping) return filteredQueue.map(v => ({ ...v, count: 1, items: [v] }));
        return groupViolationsList(filteredQueue, 2 * 60 * 1000);
    }, [filteredQueue, enableGrouping]);

    // Available Exam Options list for dropdown
    const availableExamCodes = useMemo(() => {
        const set = new Set();
        activeExams.forEach(e => { if (e.examCode) set.add(e.examCode); });
        queueData.forEach(v => { if (v.examId && v.examId !== 'Unknown') set.add(v.examId); });
        return Array.from(set);
    }, [activeExams, queueData]);

    const getSeverityBadge = (severity) => {
        if (severity >= 4) {
            return {
                label: `Critical (L${severity})`,
                bg: '#fce8e6',
                color: '#d93025',
                border: '#f5c2c7'
            };
        }
        if (severity === 3) {
            return {
                label: `Moderate (L${severity})`,
                bg: '#fef7e0',
                color: '#b45309',
                border: '#ffeeba'
            };
        }
        return {
            label: `Low (L${severity})`,
            bg: '#e6f4ea',
            color: '#137333',
            border: '#c3e6cb'
        };
    };

    return (
        <div className="md-card priority-queue-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Header Toolbar */}
            <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid #dadce0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#ffffff',
                flexWrap: 'wrap',
                gap: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'linear-gradient(135deg, #d93025, #ea4335)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff'
                    }}>
                        <Zap size={18} />
                    </div>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#202124' }}>
                                Priority Triage Queue
                            </h3>
                            <span className="md-badge status-draft" style={{ fontSize: '11px', fontWeight: 700 }}>
                                {filteredQueue.length} Unreviewed
                            </span>
                        </div>
                        <span style={{ fontSize: '12px', color: '#5f6368' }}>
                            {selectedExam === 'ALL' 
                                ? 'Live unreviewed alerts across all active exams' 
                                : `Scoped to active exam: ${selectedExam}`}
                        </span>
                    </div>
                </div>

                {/* Exam Filter Dropdown & Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {/* Live Exam Dropdown Selector */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8f9fa', padding: '4px 8px', borderRadius: '6px', border: '1px solid #dadce0' }}>
                        <Globe size={13} style={{ color: '#1a73e8' }} />
                        <label htmlFor="exam-filter-select" style={{ fontSize: '11.5px', fontWeight: 500, color: '#5f6368' }}>Exam:</label>
                        <select
                            id="exam-filter-select"
                            value={selectedExam}
                            onChange={(e) => {
                                const val = e.target.value;
                                setSelectedExam(val);
                                if (onSelectExamFilter) onSelectExamFilter(val === 'ALL' ? null : val);
                            }}
                            style={{
                                fontSize: '12px',
                                padding: '2px 6px',
                                border: '1px solid #ced4da',
                                borderRadius: '4px',
                                background: '#fff',
                                color: '#202124',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                        >
                            <option value="ALL">All Live Exams</option>
                            {availableExamCodes.map(code => (
                                <option key={code} value={code}>{code}</option>
                            ))}
                        </select>
                    </div>

                    {/* 2-Min Grouping Toggle */}
                    <button
                        type="button"
                        onClick={() => setEnableGrouping(!enableGrouping)}
                        className={`md-btn md-btn-sm ${enableGrouping ? 'md-btn-primary' : 'md-btn-outlined'}`}
                        style={{ fontSize: '11.5px', padding: '4px 8px' }}
                        title="Collapse repeated alerts of the same category within 2 minutes into a single row"
                    >
                        <Layers size={13} />
                        <span>{enableGrouping ? '2m Grouping: ON' : 'Grouping: OFF'}</span>
                    </button>

                    {/* Refresh Button */}
                    <button
                        type="button"
                        onClick={fetchPriorityQueue}
                        className="md-btn md-btn-outlined md-btn-sm"
                        style={{ padding: '4px 8px' }}
                        title="Reload Priority Queue"
                    >
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    </button>

                    {/* Severity Filters */}
                    <div className="sub-tabs">
                        <button 
                            className={`sub-tab-btn ${severityFilter === 'all' ? 'active' : ''}`}
                            onClick={() => setSeverityFilter('all')}
                        >
                            All ({queueData.length})
                        </button>
                        <button 
                            className={`sub-tab-btn ${severityFilter === 'high' ? 'active' : ''}`}
                            onClick={() => setSeverityFilter('high')}
                            style={{ color: severityFilter === 'high' ? '#d93025' : undefined }}
                        >
                            High ({queueData.filter(v => v.severity >= 4).length})
                        </button>
                        <button 
                            className={`sub-tab-btn ${severityFilter === 'medium' ? 'active' : ''}`}
                            onClick={() => setSeverityFilter('medium')}
                        >
                            Med ({queueData.filter(v => v.severity === 3).length})
                        </button>
                        <button 
                            className={`sub-tab-btn ${severityFilter === 'low' ? 'active' : ''}`}
                            onClick={() => setSeverityFilter('low')}
                        >
                            Low ({queueData.filter(v => v.severity <= 2).length})
                        </button>
                    </div>
                </div>
            </div>

            {/* Queue List Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                {loading && queueData.length === 0 ? (
                    <div className="md-empty-card" style={{ border: 'none', background: 'transparent' }}>
                        <RefreshCw size={32} className="animate-spin" style={{ color: '#1a73e8' }} />
                        <p style={{ marginTop: '10px' }}>Loading priority queue...</p>
                    </div>
                ) : displayItems.length === 0 ? (
                    <div className="md-empty-card" style={{ border: 'none', background: 'transparent', padding: '40px 20px' }}>
                        <Check size={42} style={{ color: '#188038', background: '#e6f4ea', borderRadius: '50%', padding: '8px' }} />
                        <h4 style={{ margin: '12px 0 4px', fontSize: '16px', color: '#202124' }}>All Caught Up!</h4>
                        <p style={{ margin: 0, color: '#5f6368', fontSize: '13px' }}>
                            {selectedExam !== 'ALL'
                                ? `No unreviewed violations found for exam "${selectedExam}".`
                                : severityFilter === 'all'
                                ? "No unreviewed violations across any active exams. Great job!"
                                : `No unreviewed ${severityFilter} severity violations found.`}
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {displayItems.map((group) => {
                            const badge = getSeverityBadge(group.severity);
                            const category = getCategoryInfo(group.type, group.details);
                            const isGrouped = group.count > 1;
                            const isExpanded = expandedGroupIds.has(group._id);
                            const isEvidenceOpen = expandedEvidenceIds.has(group._id);

                            // Collect all available screenshot snapshots in this group
                            const snapshots = (group.items || [group])
                                .filter(item => Boolean(item.screenshotPath || item.evidenceUrl))
                                .map(item => ({
                                    url: item.screenshotPath || item.evidenceUrl,
                                    timestamp: item.timestamp,
                                    details: item.details,
                                    severity: item.severity,
                                    id: item._id || item.id
                                }));

                            return (
                                <div 
                                    key={group._id} 
                                    className="md-card"
                                    style={{
                                        border: `1px solid ${group.severity >= 4 ? '#f5c2c7' : '#dadce0'}`,
                                        borderLeft: `5px solid ${badge.color}`,
                                        padding: '12px 16px',
                                        backgroundColor: group.severity >= 4 ? '#fffbfb' : '#ffffff',
                                        transition: 'all 0.15s ease'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                                        {/* Left Info: Student + Category + Violation Title */}
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                            <div style={{
                                                width: 38,
                                                height: 38,
                                                borderRadius: '50%',
                                                backgroundColor: badge.bg,
                                                color: badge.color,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                marginTop: 2
                                            }}>
                                                {group.severity >= 4 ? <ShieldAlert size={20} /> : <AlertTriangle size={20} />}
                                            </div>

                                            <div>
                                                {/* Student Identity Header */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '14.5px', fontWeight: 600, color: '#202124' }}>
                                                        {group.studentName}
                                                    </span>
                                                    <span style={{ fontSize: '12px', color: '#5f6368', background: '#f1f3f4', padding: '2px 6px', borderRadius: '4px' }}>
                                                        Roll: {group.rollNumber}
                                                    </span>
                                                    {group.examId && (
                                                        <span style={{ fontSize: '11px', color: '#1a73e8', background: '#e8f0fe', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                                            {group.examId}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Violation Category Tag & Description */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                                                    {/* Category Pill */}
                                                    <span style={{
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        color: category.color,
                                                        backgroundColor: category.badgeBg,
                                                        padding: '2px 6px',
                                                        borderRadius: '4px'
                                                    }}>
                                                        {category.label}
                                                    </span>

                                                    <span style={{ fontSize: '13.5px', fontWeight: 500, color: '#202124' }}>
                                                        {formatType(group.type, group.details)}
                                                    </span>

                                                    {isGrouped && (
                                                        <span style={{
                                                            fontSize: '11.5px',
                                                            fontWeight: 700,
                                                            color: '#b45309',
                                                            backgroundColor: '#fef7e0',
                                                            border: '1px solid #ffeeba',
                                                            padding: '2px 8px',
                                                            borderRadius: '12px'
                                                        }}>
                                                            {group.count}× in 2m
                                                        </span>
                                                    )}

                                                    <span style={{
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        padding: '2px 8px',
                                                        borderRadius: '12px',
                                                        backgroundColor: badge.bg,
                                                        color: badge.color,
                                                        border: `1px solid ${badge.border}`
                                                    }}>
                                                        {badge.label}
                                                    </span>
                                                </div>

                                                {/* Timestamp & Metadata */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', fontSize: '12px', color: '#5f6368', flexWrap: 'wrap' }}>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Clock size={12} />
                                                        {timeAgo(group.timestamp)} ({new Date(group.timestamp).toLocaleTimeString()})
                                                    </span>
                                                    {group.details?.confidence && (
                                                        <span>Conf: {(group.details.confidence * 100).toFixed(0)}%</span>
                                                    )}
                                                    {group.details?.object_class && (
                                                        <span>Target: <strong>{group.details.object_class}</strong></span>
                                                    )}
                                                    
                                                    {/* Collapsible Evidence Dropdown Button */}
                                                    {snapshots.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleEvidenceExpand(group._id)}
                                                            className="md-btn md-btn-text md-btn-sm"
                                                            style={{
                                                                color: '#1a73e8',
                                                                padding: '1px 6px',
                                                                fontSize: '11.5px',
                                                                fontWeight: 600,
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '4px',
                                                                background: isEvidenceOpen ? '#e8f0fe' : '#f8f9fa',
                                                                borderRadius: '4px'
                                                            }}
                                                        >
                                                            <Image size={12} />
                                                            <span>{isEvidenceOpen ? 'Hide Evidence' : `📸 Evidence (${snapshots.length})`}</span>
                                                            {isEvidenceOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right Action Controls: Confirm, Dismiss, Note, Expand Instances */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            {/* Jump to Timeline Button */}
                                            {onSelectStudentForReview && group.sessionId && (
                                                <button
                                                    type="button"
                                                    onClick={() => onSelectStudentForReview(group.sessionId)}
                                                    className="md-btn md-btn-outlined md-btn-sm"
                                                    style={{ fontSize: '12px', padding: '5px 10px' }}
                                                    title="Open candidate complete evidence timeline"
                                                >
                                                    <User size={13} />
                                                    <span>View Timeline</span>
                                                </button>
                                            )}

                                            <button 
                                                className="md-btn md-btn-sm"
                                                style={{ 
                                                    background: '#e6f4ea', 
                                                    color: '#137333', 
                                                    border: '1px solid #ceead6',
                                                    padding: '5px 10px',
                                                    fontSize: '12px'
                                                }}
                                                onClick={() => handleQuickReview(group, 'confirmed')}
                                                title={isGrouped ? `Confirm all ${group.count} instances` : "Confirm violation"}
                                            >
                                                <Check size={14} />
                                                <span>Confirm {isGrouped ? `(${group.count})` : ''}</span>
                                            </button>

                                            <button 
                                                className="md-btn md-btn-sm"
                                                style={{ 
                                                    background: '#f1f3f4', 
                                                    color: '#5f6368', 
                                                    border: '1px solid #dadce0',
                                                    padding: '5px 10px',
                                                    fontSize: '12px'
                                                }}
                                                onClick={() => handleQuickReview(group, 'dismissed')}
                                                title={isGrouped ? `Dismiss all ${group.count} instances` : "Dismiss as false positive"}
                                            >
                                                <X size={14} />
                                                <span>Dismiss</span>
                                            </button>

                                            <button 
                                                className="md-btn md-btn-outlined md-btn-sm"
                                                style={{ padding: '5px 8px' }}
                                                onClick={() => {
                                                    setSelectedViolationForNote(group);
                                                    setNoteText(group.reviewNote || '');
                                                    setNoteDecision('confirmed');
                                                }}
                                                title="Add Review Note"
                                            >
                                                <MessageSquare size={14} />
                                            </button>

                                            {isGrouped && (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleGroupExpand(group._id)}
                                                    className="md-btn md-btn-text md-btn-sm"
                                                    style={{ padding: '5px 8px' }}
                                                    title={isExpanded ? "Collapse instances" : "Expand all instances"}
                                                >
                                                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Collapsible Evidence Snapshots Gallery Drawer */}
                                    {snapshots.length > 0 && isEvidenceOpen && (
                                        <div style={{
                                            marginTop: '10px',
                                            padding: '10px 12px',
                                            background: '#f8f9fa',
                                            borderRadius: '6px',
                                            border: '1px solid #e8eaed',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#3c4043' }}>
                                                    📸 Captured Evidence ({snapshots.length} Snapshots) — Click to Enlarge
                                                </span>
                                                <span style={{ fontSize: '11px', color: '#5f6368' }}>
                                                    Category: {category.label}
                                                </span>
                                            </div>

                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                                                gap: '10px'
                                            }}>
                                                {snapshots.map((snap, sIdx) => {
                                                    const fullUrl = snap.url.startsWith('http') ? snap.url : `${API_BASE}${snap.url}`;
                                                    return (
                                                        <div 
                                                            key={snap.id || sIdx}
                                                            style={{
                                                                background: '#fff',
                                                                borderRadius: '6px',
                                                                border: '1px solid #dadce0',
                                                                overflow: 'hidden',
                                                                display: 'flex',
                                                                flexDirection: 'column'
                                                            }}
                                                        >
                                                            <div 
                                                                style={{ position: 'relative', cursor: 'pointer', background: '#000', height: '110px' }}
                                                                onClick={() => setModalImageSrc(fullUrl)}
                                                                title="Click to zoom full screenshot"
                                                            >
                                                                <img 
                                                                    src={fullUrl} 
                                                                    alt={`Evidence ${sIdx + 1}`}
                                                                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                                                                />
                                                                <span style={{
                                                                    position: 'absolute',
                                                                    bottom: 4,
                                                                    right: 4,
                                                                    background: 'rgba(0,0,0,0.7)',
                                                                    color: '#fff',
                                                                    padding: '2px 4px',
                                                                    borderRadius: '3px',
                                                                    fontSize: '10px'
                                                                }}>
                                                                    <Maximize2 size={10} style={{ verticalAlign: 'middle' }} /> Zoom
                                                                </span>
                                                            </div>
                                                            <div style={{ padding: '6px 8px', fontSize: '11px', color: '#5f6368', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span>#{sIdx + 1} &bull; {new Date(snap.timestamp).toLocaleTimeString()}</span>
                                                                {snap.details?.confidence && (
                                                                    <span style={{ fontWeight: 600, color: '#1a73e8' }}>
                                                                        {Math.round(snap.details.confidence * 100)}%
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Expanded Nested Instances View */}
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
                                                Individual Instances ({group.items.length})
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
                                                        {(item.screenshotPath || item.evidenceUrl) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const path = item.screenshotPath || item.evidenceUrl;
                                                                    setModalImageSrc(path.startsWith('http') ? path : `${API_BASE}${path}`);
                                                                }}
                                                                style={{ color: '#1a73e8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11.5px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '3px' }}
                                                            >
                                                                <Image size={11} />
                                                                <span>View Snapshot</span>
                                                            </button>
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
            </div>

            {/* Zoom Modal for Evidence Screenshot */}
            {modalImageSrc && (
                <div 
                    className="modal-backdrop" 
                    onClick={() => setModalImageSrc(null)}
                    style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)' }}
                >
                    <div 
                        className="md-card" 
                        onClick={(e) => e.stopPropagation()} 
                        style={{ maxWidth: '90vw', maxHeight: '90vh', padding: '12px', background: '#0f172a', borderRadius: '8px', position: 'relative' }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', color: '#fff' }}>
                            <span style={{ fontSize: '13px', fontWeight: 500 }}>High-Resolution Evidence Snapshot</span>
                            <button 
                                onClick={() => setModalImageSrc(null)}
                                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px' }}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <img 
                            src={modalImageSrc} 
                            alt="Zoom Evidence" 
                            style={{ maxWidth: '86vw', maxHeight: '78vh', objectFit: 'contain', display: 'block', borderRadius: '4px' }} 
                        />
                    </div>
                </div>
            )}

            {/* Note Dialog Modal */}
            {selectedViolationForNote && (
                <div className="modal-backdrop">
                    <div className="md-card md-modal-card" style={{ width: '440px' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid #dadce0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 500, color: '#202124' }}>
                                Add Reviewer Note
                            </h3>
                            <button 
                                onClick={() => setSelectedViolationForNote(null)} 
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368' }}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleNoteModalSubmit} style={{ padding: '20px' }}>
                            <div style={{ marginBottom: '14px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#5f6368', marginBottom: '6px' }}>
                                    Decision
                                </label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button
                                        type="button"
                                        className={`md-btn md-btn-sm ${noteDecision === 'confirmed' ? 'md-btn-primary' : 'md-btn-outlined'}`}
                                        style={{ flex: 1 }}
                                        onClick={() => setNoteDecision('confirmed')}
                                    >
                                        <Check size={14} />
                                        <span>Confirm Violation</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`md-btn md-btn-sm ${noteDecision === 'dismissed' ? 'md-btn-primary' : 'md-btn-outlined'}`}
                                        style={{ flex: 1 }}
                                        onClick={() => setNoteDecision('dismissed')}
                                    >
                                        <X size={14} />
                                        <span>Dismiss Alert</span>
                                    </button>
                                </div>
                            </div>

                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#5f6368', marginBottom: '6px' }}>
                                    Note / Justification
                                </label>
                                <textarea
                                    className="md-input"
                                    rows="3"
                                    placeholder="Explain why this alert was confirmed or dismissed..."
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                    style={{ width: '100%', resize: 'vertical' }}
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                <button
                                    type="button"
                                    className="md-btn md-btn-text"
                                    onClick={() => setSelectedViolationForNote(null)}
                                    disabled={submitting}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="md-btn md-btn-primary"
                                    disabled={submitting}
                                >
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
