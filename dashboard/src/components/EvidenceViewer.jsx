import React, { useEffect, useState, useMemo } from 'react';
import { getViolations } from '../services/api';
import { 
    Check, X, Clock, CheckCircle, XCircle, Eye, Camera, AlertTriangle, 
    ShieldCheck, FileText, Download, Paperclip, AlertOctagon, MessageSquare, 
    Send, UserX, AlertCircle, Image, Maximize2, ChevronDown, ChevronUp,
    Layers, Filter, Sparkles, Smartphone, Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Components.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

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
    if (!typeStr) return { key: 'other', label: 'General Alert', icon: '⚠️', color: '#5f6368', badgeBg: '#f1f3f4' };
    if (typeStr.includes('object') || typeStr.includes('phone') || details?.object_class) {
        const item = details?.object_class ? details.object_class.toLowerCase() : 'Mobile / Object';
        return { 
            key: 'objects',
            label: `📱 ${item.charAt(0).toUpperCase() + item.slice(1)}`, 
            icon: '📱', 
            color: '#b91c1c', 
            badgeBg: '#fee2e2' 
        };
    }
    if (typeStr.includes('head') || typeStr.includes('turn') || typeStr.includes('gaze')) {
        return { key: 'head', label: '👤 Head / Gaze Turn', icon: '👤', color: '#b45309', badgeBg: '#fef3c7' };
    }
    if (typeStr.includes('second_person') || typeStr.includes('multiple_faces')) {
        return { key: 'people', label: '👥 Second Person', icon: '👥', color: '#b91c1c', badgeBg: '#fee2e2' };
    }
    if (typeStr.includes('no_face')) {
        return { key: 'noface', label: '👁️ Face Missing', icon: '👁️', color: '#c2410c', badgeBg: '#ffedd5' };
    }
    if (typeStr.includes('app') || typeStr.includes('window')) {
        return { key: 'app', label: '🖥️ App Switch', icon: '🖥️', color: '#4338ca', badgeBg: '#e0e7ff' };
    }
    if (typeStr.includes('camera') || typeStr.includes('dark')) {
        return { key: 'camera', label: '🌑 Camera Feed Dark', icon: '🌑', color: '#4b5563', badgeBg: '#f3f4f6' };
    }
    return { key: 'other', label: '⚠️ Suspicious Activity', icon: '⚠️', color: '#b45309', badgeBg: '#fef3c7' };
}

export default function EvidenceViewer({ sessionId, liveViolations = [] }) {
    const { authFetch } = useAuth();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sessionData, setSessionData] = useState(null);
    const [submissions, setSubmissions] = useState([]);
    const [cameraActionLoading, setCameraActionLoading] = useState(false);
    const [showDismissedLogs, setShowDismissedLogs] = useState(false);

    // Filtering & Categorized Accordion States
    const [categoryFilter, setCategoryFilter] = useState('all'); // 'all', 'objects', 'head', 'people', 'noface', 'app'
    const [groupByCategory, setGroupByCategory] = useState(true);
    const [expandedCategoryKeys, setExpandedCategoryKeys] = useState(new Set());
    const [modalImageSrc, setModalImageSrc] = useState(null);

    // Live Candidate Action States
    const [showWarnModal, setShowWarnModal] = useState(false);
    const [warnMessage, setWarnMessage] = useState('');
    const [warnSuccess, setWarnSuccess] = useState(false);

    const [showTerminateModal, setShowTerminateModal] = useState(false);
    const [terminateReason, setTerminateReason] = useState('');
    const [actionSubmitting, setActionSubmitting] = useState(false);

    const fetchHistory = () => {
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
    };

    const fetchSessionData = () => {
        if (!sessionId) return;
        authFetch(`${API_BASE_URL}/sessions/${sessionId}/status`)
            .then(res => {
                if (res.ok) return res.json();
                // Fallback to active sessions
                return authFetch(`${API_BASE_URL}/sessions/active`)
                    .then(r => r.json())
                    .then(data => Array.isArray(data) ? data.find(item => String(item._id || item.sessionId) === String(sessionId)) : null);
            })
            .then(s => {
                if (s) setSessionData(s);
            })
            .catch(err => console.error("Error fetching session info:", err));
    };

    const fetchSubmissions = () => {
        if (!sessionId) return;
        authFetch(`${API_BASE_URL}/submissions/${sessionId}`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setSubmissions(data);
                }
            })
            .catch(err => console.error("Error fetching submissions:", err));
    };

    useEffect(() => {
        fetchHistory();
        fetchSessionData();
        fetchSubmissions();
    }, [sessionId]);

    // Real-time synchronization with live socket violations
    useEffect(() => {
        if (!liveViolations || liveViolations.length === 0 || !sessionId) return;

        setHistory(prev => {
            let updated = [...prev];
            let hasChanges = false;

            liveViolations.forEach(liveV => {
                if (String(liveV.sessionId) === String(sessionId)) {
                    const existingIdx = updated.findIndex(item => String(item._id) === String(liveV._id));
                    if (existingIdx === -1) {
                        updated.unshift(liveV);
                        hasChanges = true;
                    }
                }
            });

            return hasChanges ? updated : prev;
        });
    }, [liveViolations, sessionId]);

    const handleReviewAction = async (violationId, decision) => {
        // Optimistically update local timeline state
        setHistory(prev => prev.map(v => {
            if (v._id === violationId) {
                return {
                    ...v,
                    reviewed: true,
                    decision: decision,
                    reviewedAt: new Date().toISOString()
                };
            }
            return v;
        }));

        try {
            const res = await authFetch(`${API_BASE_URL}/violations/${violationId}/review`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reviewed: true,
                    decision: decision
                })
            });

            if (res.ok) {
                fetchHistory();
            }
        } catch (err) {
            console.error('Error updating review:', err);
        }
    };

    const handleCameraVerificationAction = async (status, note = '') => {
        if (!sessionId) return;
        setCameraActionLoading(true);

        setSessionData(prev => prev ? ({ ...prev, cameraVerificationStatus: status }) : prev);

        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sessionId}/camera-verification`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, note })
            });

            if (res.ok) {
                const data = await res.json();
                setSessionData(data.session);
                fetchHistory();
            }
        } catch (err) {
            console.error('Error updating camera verification:', err);
        } finally {
            setCameraActionLoading(false);
        }
    };

    const handleSendWarning = async (e) => {
        e.preventDefault();
        if (!warnMessage.trim() || !sessionId) return;

        setActionSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sessionId}/warn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: warnMessage })
            });

            if (res.ok) {
                setWarnSuccess(true);
                setTimeout(() => {
                    setWarnSuccess(false);
                    setShowWarnModal(false);
                    setWarnMessage('');
                    fetchSessionData();
                }, 1200);
            }
        } catch (err) {
            console.error('Failed to send warning:', err);
        } finally {
            setActionSubmitting(false);
        }
    };

    const handleTerminate = async (e) => {
        e.preventDefault();
        if (!terminateReason.trim() || !sessionId) return;

        setActionSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sessionId}/terminate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: terminateReason })
            });

            if (res.ok) {
                setShowTerminateModal(false);
                setTerminateReason('');
                fetchSessionData();
            }
        } catch (err) {
            console.error('Failed to terminate candidate:', err);
        } finally {
            setActionSubmitting(false);
        }
    };

    const toggleCategoryExpand = (catKey) => {
        setExpandedCategoryKeys(prev => {
            const next = new Set(prev);
            if (next.has(catKey)) next.delete(catKey);
            else next.add(catKey);
            return next;
        });
    };

    // Filter active and dismissed violations
    const activeViolations = useMemo(() => {
        return history.filter(v => v.decision !== 'dismissed');
    }, [history]);

    const dismissedViolations = useMemo(() => {
        return history.filter(v => v.decision === 'dismissed');
    }, [history]);

    // Apply Category Filter
    const filteredActiveViolations = useMemo(() => {
        if (categoryFilter === 'all') return activeViolations;
        return activeViolations.filter(v => {
            const cat = getCategoryInfo(v.type, v.details);
            return cat.key === categoryFilter;
        });
    }, [activeViolations, categoryFilter]);

    // Group active violations into Category Bundles
    const categorizedBundles = useMemo(() => {
        const bundleMap = new Map();

        filteredActiveViolations.forEach(v => {
            const cat = getCategoryInfo(v.type, v.details);
            const bundleKey = cat.key;

            if (!bundleMap.has(bundleKey)) {
                bundleMap.set(bundleKey, {
                    key: bundleKey,
                    label: cat.label,
                    icon: cat.icon,
                    color: cat.color,
                    badgeBg: cat.badgeBg,
                    items: [],
                    maxSeverity: v.severity || 1,
                    unreviewedCount: 0,
                    latestTimestamp: v.timestamp
                });
            }

            const bundle = bundleMap.get(bundleKey);
            bundle.items.push(v);
            if (Number(v.severity) > Number(bundle.maxSeverity)) {
                bundle.maxSeverity = v.severity;
            }
            if (!v.reviewed) {
                bundle.unreviewedCount += 1;
            }
            if (new Date(v.timestamp) > new Date(bundle.latestTimestamp)) {
                bundle.latestTimestamp = v.timestamp;
            }
        });

        return Array.from(bundleMap.values()).sort((a, b) => b.maxSeverity - a.maxSeverity);
    }, [filteredActiveViolations]);

    if (!sessionId) {
        return (
            <div className="md-card evidence-card">
                <div className="md-empty-card" style={{ border: 'none', background: 'transparent' }}>
                    <Eye size={36} className="md-empty-icon" />
                    <p style={{ margin: 0 }}>Select a candidate from the left list to review violation evidence.</p>
                </div>
            </div>
        );
    }

    if (loading) return (
        <div className="md-card evidence-card">
            <div className="md-loading">Loading evidence timeline...</div>
        </div>
    );

    const cameraPhotoUrl = sessionData?.cameraVerificationPhoto 
        ? (sessionData.cameraVerificationPhoto.startsWith('http://') || sessionData.cameraVerificationPhoto.startsWith('https://')
            ? sessionData.cameraVerificationPhoto
            : `${API_BASE_URL.replace(/\/$/, '')}/${sessionData.cameraVerificationPhoto.replace(/^\//, '')}`)
        : null;
    const cameraStatus = sessionData?.cameraVerificationStatus || 'none';
    const isTerminated = sessionData?.status === 'terminated';

    const studentDisplayName = sessionData?.studentName || sessionData?.studentId || 'Candidate';
    const rollDisplay = sessionData?.rollNumber ? ` (${sessionData.rollNumber})` : (sessionData?.studentId && sessionData.studentId !== sessionData.studentName ? ` (${sessionData.studentId})` : '');

    return (
        <div className="md-card evidence-card" style={{ overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>

                {/* Candidate Action Control Bar Header */}
                <div style={{ background: isTerminated ? '#fce8e6' : '#e8f0fe', border: isTerminated ? '1px solid #fad2cf' : '1px solid #c2e7ff', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 600, fontSize: '15px', color: '#202124' }}>
                                Viewing: {studentDisplayName}{rollDisplay}
                            </span>
                            <span className={`md-badge ${isTerminated ? 'status-completed' : 'status-active'}`} style={{ textTransform: 'uppercase', background: isTerminated ? '#d93025' : '#188038', color: '#ffffff' }}>
                                {isTerminated ? 'Terminated' : 'Active Live'}
                            </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#5f6368', marginTop: '2px' }}>
                            Exam: <strong>{sessionData?.examId || ''}</strong> &bull; Session: <span title={String(sessionId)} style={{ cursor: 'help' }}>{String(sessionId).substring(0, 8)}...</span>
                            {sessionData?.warnings && sessionData.warnings.length > 0 && ` &bull; Warnings Sent: ${sessionData.warnings.length}`}
                        </div>
                    </div>

                    {!isTerminated ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button 
                                className="md-btn md-btn-sm" 
                                style={{ background: '#ffffff', color: '#1a73e8', border: '1px solid #1a73e8' }}
                                onClick={() => {
                                    setWarnMessage("Please remain facing the camera directly at all times.");
                                    setShowWarnModal(true);
                                }}
                            >
                                <MessageSquare size={14} />
                                <span>Send Warning</span>
                            </button>
                            <button 
                                className="md-btn md-btn-sm" 
                                style={{ background: '#d93025', color: '#ffffff', border: 'none' }}
                                onClick={() => setShowTerminateModal(true)}
                            >
                                <UserX size={14} />
                                <span>Terminate Candidate</span>
                            </button>
                        </div>
                    ) : (
                        <div style={{ color: '#d93025', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <AlertCircle size={14} />
                            <span>Session Terminated: "{sessionData?.terminationReason || 'Integrity Violation'}"</span>
                        </div>
                    )}
                </div>

                {/* Candidate Exam Submissions Section */}
                {submissions.length > 0 && (
                    <div className="alert-item" style={{ background: '#f8f9fa', border: '1px solid #1a73e8', borderRadius: '8px', padding: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FileText size={18} style={{ color: '#1a73e8' }} />
                                <span style={{ fontWeight: 600, fontSize: '14px', color: '#202124' }}>
                                    Candidate Answer Submission
                                </span>
                            </div>
                            <span className="md-badge status-active">
                                <CheckCircle size={12} />
                                <span>Submitted</span>
                            </span>
                        </div>

                        {submissions.map((sub, idx) => (
                            <div key={sub._id || idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12.5px', background: '#fff', border: '1px solid #dadce0', borderRadius: '6px', padding: '8px 12px' }}>
                                <span>📄 {sub.originalName || 'answer_script.pdf'}</span>
                                {sub.fileUrl && (
                                    <a 
                                        href={sub.fileUrl.startsWith('http') ? sub.fileUrl : `${API_BASE_URL}${sub.fileUrl}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: '#1a73e8', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none', fontWeight: 500 }}
                                    >
                                        <Download size={13} />
                                        <span>Download Script</span>
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Categorized Filter & Accordion Toolbar */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#f8f9fa',
                    border: '1px solid #dadce0',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    flexWrap: 'wrap',
                    gap: '8px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Filter size={15} style={{ color: '#5f6368' }} />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#202124' }}>
                            Evidence Timeline ({activeViolations.length} Active Incidents)
                        </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {/* Group By Category Toggle */}
                        <button
                            type="button"
                            onClick={() => setGroupByCategory(!groupByCategory)}
                            className={`md-btn md-btn-sm ${groupByCategory ? 'md-btn-primary' : 'md-btn-outlined'}`}
                            style={{ fontSize: '11.5px', padding: '3px 8px' }}
                            title="Group repeated evidence by category dropdowns (e.g. Mobile, Head Turn) so you are not overwhelmed"
                        >
                            <Layers size={13} />
                            <span>{groupByCategory ? 'Group by Category: ON' : 'Category Accordions: OFF'}</span>
                        </button>

                        {/* Category Filter Pills */}
                        <div className="sub-tabs">
                            <button
                                className={`sub-tab-btn ${categoryFilter === 'all' ? 'active' : ''}`}
                                onClick={() => setCategoryFilter('all')}
                            >
                                All ({activeViolations.length})
                            </button>
                            <button
                                className={`sub-tab-btn ${categoryFilter === 'objects' ? 'active' : ''}`}
                                onClick={() => setCategoryFilter('objects')}
                            >
                                📱 Mobile/Object
                            </button>
                            <button
                                className={`sub-tab-btn ${categoryFilter === 'head' ? 'active' : ''}`}
                                onClick={() => setCategoryFilter('head')}
                            >
                                👤 Head Turn
                            </button>
                            <button
                                className={`sub-tab-btn ${categoryFilter === 'people' ? 'active' : ''}`}
                                onClick={() => setCategoryFilter('people')}
                            >
                                👥 2nd Person
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Evidence Content */}
                {filteredActiveViolations.length === 0 ? (
                    <div className="md-empty-card" style={{ border: 'none', background: 'transparent', padding: '30px 20px' }}>
                        <CheckCircle size={36} style={{ color: '#188038', marginBottom: '8px' }} />
                        <h4 style={{ margin: 0, fontSize: '15px', color: '#202124' }}>No Active Violations Found</h4>
                        <p style={{ margin: '4px 0 0 0', color: '#5f6368', fontSize: '12.5px' }}>
                            {dismissedViolations.length > 0 
                                ? `${dismissedViolations.length} alert(s) were dismissed as false positives.` 
                                : 'This candidate has maintained clean monitoring status.'}
                        </p>
                    </div>
                ) : groupByCategory ? (
                    /* Categorized Accordion Dropdowns (Mobile vs Mobile, Head vs Head) */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {categorizedBundles.map(bundle => {
                            // Default all expanded or let user toggle
                            const isExpanded = !expandedCategoryKeys.has(bundle.key); // Default OPEN
                            const snapshots = bundle.items.filter(i => Boolean(i.screenshotPath));

                            return (
                                <div 
                                    key={bundle.key}
                                    className="md-card"
                                    style={{
                                        border: `1px solid ${bundle.maxSeverity >= 4 ? '#f5c2c7' : '#dadce0'}`,
                                        borderLeft: `5px solid ${bundle.color}`,
                                        padding: 0,
                                        overflow: 'hidden',
                                        background: '#fff'
                                    }}
                                >
                                    {/* Accordion Category Header */}
                                    <div 
                                        onClick={() => toggleCategoryExpand(bundle.key)}
                                        style={{
                                            padding: '12px 16px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            cursor: 'pointer',
                                            background: bundle.badgeBg,
                                            borderBottom: isExpanded ? '1px solid #dadce0' : 'none',
                                            userSelect: 'none'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ fontSize: '18px' }}>{bundle.icon}</span>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '14.5px', fontWeight: 600, color: '#202124' }}>
                                                        {bundle.label}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        color: bundle.color,
                                                        background: '#fff',
                                                        padding: '2px 8px',
                                                        borderRadius: '10px',
                                                        border: `1px solid ${bundle.color}`
                                                    }}>
                                                        {bundle.items.length} Incident{bundle.items.length > 1 ? 's' : ''}
                                                    </span>
                                                    {bundle.unreviewedCount > 0 && (
                                                        <span className="md-badge status-draft" style={{ fontSize: '10px' }}>
                                                            {bundle.unreviewedCount} Needs Review
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '11.5px', color: '#5f6368', marginTop: '2px' }}>
                                                    Latest: {new Date(bundle.latestTimestamp).toLocaleTimeString()} &bull; Severity: {bundle.maxSeverity} &bull; {snapshots.length} Snapshots
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '12px', fontWeight: 500, color: '#1a73e8' }}>
                                                {isExpanded ? 'Collapse Category' : `Expand (${bundle.items.length})`}
                                            </span>
                                            {isExpanded ? <ChevronUp size={16} color="#1a73e8" /> : <ChevronDown size={16} color="#1a73e8" />}
                                        </div>
                                    </div>

                                    {/* Accordion Body: Evidence Snapshots & Decisions */}
                                    {isExpanded && (
                                        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px', background: '#fafbfc' }}>
                                            {bundle.items.map((v, vIdx) => {
                                                const isReviewed = Boolean(v.reviewed);
                                                const decision = v.decision || 'pending';
                                                const imageSrc = v.screenshotPath 
                                                    ? (v.screenshotPath.startsWith('http://') || v.screenshotPath.startsWith('https://')
                                                        ? v.screenshotPath
                                                        : `${API_BASE_URL.replace(/\/$/, '')}/${v.screenshotPath.replace(/^\//, '')}`)
                                                    : null;

                                                return (
                                                    <div 
                                                        key={v._id || vIdx}
                                                        style={{
                                                            background: isReviewed ? '#f8f9fa' : '#ffffff',
                                                            border: isReviewed ? '1px solid #e8eaed' : '1px solid #1a73e8',
                                                            borderRadius: '6px',
                                                            padding: '10px 14px'
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span style={{ fontWeight: 600, fontSize: '13.5px', color: '#202124' }}>
                                                                    #{vIdx + 1} &bull; {formatType(v.type, v.details)}
                                                                </span>
                                                                <span className="md-badge" style={{ fontSize: '10.5px' }}>
                                                                    Sev {v.severity}
                                                                </span>
                                                                {v.details?.confidence && (
                                                                    <span style={{ fontSize: '11px', color: '#5f6368' }}>
                                                                        ({Math.round(v.details.confidence * 100)}% conf)
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span style={{ fontSize: '11.5px', color: '#70757a' }}>
                                                                    {new Date(v.timestamp).toLocaleTimeString()}
                                                                </span>
                                                                {isReviewed ? (
                                                                    <span className={`md-badge ${decision === 'confirmed' ? 'status-active' : 'status-completed'}`} style={{ fontSize: '10.5px' }}>
                                                                        {decision === 'confirmed' ? <CheckCircle size={11} /> : <XCircle size={11} />}
                                                                        <span style={{ textTransform: 'capitalize' }}>{decision}</span>
                                                                    </span>
                                                                ) : (
                                                                    <span className="md-badge status-draft" style={{ fontSize: '10.5px' }}>
                                                                        Needs Review
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {v.details?.reason && (
                                                            <div style={{ fontSize: '11.5px', color: '#5f6368', marginBottom: '6px' }}>
                                                                Detail: {v.details.reason}
                                                            </div>
                                                        )}

                                                        {imageSrc && (
                                                            <div 
                                                                style={{ 
                                                                    marginTop: '6px', 
                                                                    marginBottom: '8px', 
                                                                    borderRadius: '6px', 
                                                                    overflow: 'hidden', 
                                                                    border: '1px solid #dadce0', 
                                                                    background: '#000',
                                                                    position: 'relative',
                                                                    cursor: 'pointer',
                                                                    maxHeight: '220px'
                                                                }}
                                                                onClick={() => setModalImageSrc(imageSrc)}
                                                                title="Click to zoom full screenshot"
                                                            >
                                                                <img 
                                                                    src={imageSrc} 
                                                                    alt="Violation Evidence" 
                                                                    style={{ width: '100%', maxHeight: '220px', objectFit: 'contain', display: 'block' }} 
                                                                />
                                                                <span style={{
                                                                    position: 'absolute',
                                                                    bottom: 6,
                                                                    right: 6,
                                                                    background: 'rgba(0,0,0,0.7)',
                                                                    color: '#fff',
                                                                    padding: '2px 6px',
                                                                    borderRadius: '4px',
                                                                    fontSize: '11px',
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: '3px'
                                                                }}>
                                                                    <Maximize2 size={11} /> Click to Enlarge
                                                                </span>
                                                            </div>
                                                        )}

                                                        {/* Inline Review Decision Controls */}
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #f1f3f4', paddingTop: '6px' }}>
                                                            <button 
                                                                className="md-btn md-btn-sm" 
                                                                style={{ background: decision === 'confirmed' ? '#e6f4ea' : '#f1f3f4', color: decision === 'confirmed' ? '#137333' : '#5f6368', border: '1px solid #dadce0', fontSize: '11.5px', padding: '3px 8px' }}
                                                                onClick={() => handleReviewAction(v._id, 'confirmed')}
                                                            >
                                                                <Check size={12} />
                                                                <span>Confirm</span>
                                                            </button>
                                                            <button 
                                                                className="md-btn md-btn-sm" 
                                                                style={{ background: '#ffffff', color: '#d93025', border: '1px solid #fad2cf', fontSize: '11.5px', padding: '3px 8px' }}
                                                                onClick={() => handleReviewAction(v._id, 'dismissed')}
                                                            >
                                                                <X size={12} />
                                                                <span>Dismiss</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    /* Flat Chronological Timeline */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {filteredActiveViolations.map(v => {
                            const isReviewed = Boolean(v.reviewed);
                            const decision = v.decision || 'pending';
                            const imageSrc = v.screenshotPath 
                                ? (v.screenshotPath.startsWith('http://') || v.screenshotPath.startsWith('https://')
                                    ? v.screenshotPath
                                    : `${API_BASE_URL.replace(/\/$/, '')}/${v.screenshotPath.replace(/^\//, '')}`)
                                : null;

                            return (
                                <div 
                                    key={v._id} 
                                    className={`alert-item alert-severity-${v.severity}`}
                                    style={{
                                        background: isReviewed ? '#f8f9fa' : '#ffffff',
                                        border: isReviewed ? '1px solid #dadce0' : '1px solid #1a73e8'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <div>
                                            <span style={{ fontWeight: 600, fontSize: '14.5px', color: '#202124' }}>
                                                {formatType(v.type, v.details)}
                                            </span>
                                            <span className="md-badge" style={{ fontSize: '11px', background: '#f1f3f4', marginLeft: '8px' }}>
                                                Severity {v.severity}
                                            </span>
                                        </div>
                                        <span style={{ fontSize: '12px', color: '#70757a' }}>
                                            {new Date(v.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>

                                    {imageSrc && (
                                        <div 
                                            style={{ marginTop: '8px', marginBottom: '10px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #dadce0', background: '#000', cursor: 'pointer' }}
                                            onClick={() => setModalImageSrc(imageSrc)}
                                        >
                                            <img 
                                                src={imageSrc} 
                                                alt="Evidence Snapshot" 
                                                style={{ width: '100%', maxHeight: '280px', objectFit: 'contain', display: 'block' }} 
                                            />
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                                        <button 
                                            className="md-btn md-btn-sm" 
                                            style={{ background: decision === 'confirmed' ? '#e6f4ea' : '#f1f3f4', color: decision === 'confirmed' ? '#137333' : '#5f6368', border: '1px solid #dadce0' }}
                                            onClick={() => handleReviewAction(v._id, 'confirmed')}
                                        >
                                            <Check size={14} />
                                            <span>Confirm</span>
                                        </button>
                                        <button 
                                            className="md-btn md-btn-sm" 
                                            style={{ background: '#ffffff', color: '#d93025', border: '1px solid #fad2cf' }}
                                            onClick={() => handleReviewAction(v._id, 'dismissed')}
                                        >
                                            <X size={14} />
                                            <span>Dismiss</span>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Dismissed / False Positive Audit Logs */}
                {dismissedViolations.length > 0 && (
                    <div style={{ marginTop: '16px', borderTop: '1px solid #e8eaed', paddingTop: '12px' }}>
                        <button 
                            type="button"
                            className="md-btn md-btn-sm md-btn-text"
                            onClick={() => setShowDismissedLogs(!showDismissedLogs)}
                            style={{ color: '#5f6368', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', cursor: 'pointer' }}
                        >
                            <Clock size={13} />
                            <span>{showDismissedLogs ? 'Hide' : 'View'} Dismissed Logs ({dismissedViolations.length})</span>
                        </button>

                        {showDismissedLogs && (
                            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {dismissedViolations.map(dv => (
                                    <div key={dv._id} style={{ background: '#f8f9fa', border: '1px dashed #dadce0', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: '#5f6368', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div>
                                            <strong>{formatType(dv.type, dv.details)}</strong> (Severity {dv.severity}) • {new Date(dv.timestamp).toLocaleTimeString()}
                                        </div>
                                        <span className="md-badge" style={{ background: '#e8eaed', color: '#5f6368', fontSize: '10px' }}>
                                            Dismissed
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* High-Resolution Modal Screenshot Preview */}
            {modalImageSrc && (
                <div 
                    className="modal-backdrop" 
                    onClick={() => setModalImageSrc(null)}
                    style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)' }}
                >
                    <div 
                        className="md-card" 
                        onClick={(e) => e.stopPropagation()} 
                        style={{ maxWidth: '90vw', maxHeight: '90vh', padding: '12px', background: '#0f172a', borderRadius: '8px' }}
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

            {/* Send Warning Modal */}
            {showWarnModal && (
                <div className="md-modal-overlay">
                    <div className="md-modal-card" style={{ maxWidth: '460px' }}>
                        <div className="md-modal-header">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1a73e8' }}>
                                <MessageSquare size={18} /> Send Warning to Candidate
                            </h3>
                            <button className="md-icon-btn" onClick={() => setShowWarnModal(false)}>
                                <X size={20} />
                            </button>
                        </div>

                        {warnSuccess ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: '#137333' }}>
                                <CheckCircle size={36} style={{ marginBottom: '8px' }} />
                                <div style={{ fontSize: '15px', fontWeight: 600 }}>Warning Sent to Candidate App!</div>
                            </div>
                        ) : (
                            <form onSubmit={handleSendWarning}>
                                <div className="md-form-group">
                                    <label>Select Template or Type Custom Message *</label>
                                    <select 
                                        className="md-select" 
                                        style={{ marginBottom: '8px' }}
                                        onChange={(e) => setWarnMessage(e.target.value)}
                                        defaultValue="Please remain facing the camera directly at all times."
                                    >
                                        <option value="Please remain facing the camera directly at all times.">Please remain facing camera</option>
                                        <option value="Suspicious head movement detected. Focus on your exam screen.">Suspicious movement detected</option>
                                        <option value="Unauthorized object detected in view. Remove it immediately.">Unauthorized object detected</option>
                                        <option value="Second person detected in your room. Ensure you are alone.">Second person detected</option>
                                        <option value="Your exam environment is too dark. Improve lighting immediately.">Camera feed too dark</option>
                                    </select>
                                    <textarea
                                        className="md-input"
                                        rows="3"
                                        value={warnMessage}
                                        onChange={(e) => setWarnMessage(e.target.value)}
                                        placeholder="Type custom warning message..."
                                        required
                                        style={{ width: '100%', resize: 'vertical' }}
                                    />
                                </div>
                                <div className="md-modal-actions">
                                    <button 
                                        type="button" 
                                        className="md-btn md-btn-outlined" 
                                        onClick={() => setShowWarnModal(false)}
                                        disabled={actionSubmitting}
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit" 
                                        className="md-btn md-btn-primary"
                                        disabled={actionSubmitting || !warnMessage.trim()}
                                    >
                                        {actionSubmitting ? 'Sending...' : 'Send Warning Toast'}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* Terminate Candidate Modal */}
            {showTerminateModal && (
                <div className="md-modal-overlay">
                    <div className="md-modal-card" style={{ maxWidth: '460px' }}>
                        <div className="md-modal-header">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d93025' }}>
                                <AlertOctagon size={18} /> Terminate Candidate Session
                            </h3>
                            <button className="md-icon-btn" onClick={() => setShowTerminateModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleTerminate}>
                            <p style={{ color: '#5f6368', fontSize: '13px', margin: '0 0 16px 0' }}>
                                Are you sure you want to terminate <strong>{studentDisplayName}</strong>'s exam session? The candidate app will be immediately locked out.
                            </p>
                            <div className="md-form-group">
                                <label>Termination Reason / Violation Evidence *</label>
                                <textarea
                                    className="md-input"
                                    rows="3"
                                    value={terminateReason}
                                    onChange={(e) => setTerminateReason(e.target.value)}
                                    placeholder="e.g. Repeated unauthorized phone usage confirmed on camera."
                                    required
                                    style={{ width: '100%', resize: 'vertical' }}
                                />
                            </div>
                            <div className="md-modal-actions">
                                <button 
                                    type="button" 
                                    className="md-btn md-btn-outlined" 
                                    onClick={() => setShowTerminateModal(false)}
                                    disabled={actionSubmitting}
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    className="md-btn"
                                    style={{ background: '#d93025', color: '#ffffff' }}
                                    disabled={actionSubmitting || !terminateReason.trim()}
                                >
                                    {actionSubmitting ? 'Terminating...' : 'Confirm Termination'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}