import React, { useEffect, useState, useMemo } from 'react';
import { getViolations } from '../services/api';
import { assetUrl } from '../services/api';
import { 
    Check, X, Clock, CheckCircle, XCircle, Eye, Camera, AlertTriangle, 
    ShieldCheck, FileText, Download, Paperclip, AlertOctagon, MessageSquare, 
    Send, UserX, AlertCircle, Image, Maximize2, ChevronDown, ChevronUp,
    Layers, Filter, Sparkles, Smartphone, Users, Copy, CheckCheck, ExternalLink, FileCode
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
    if (typeStr === 'pre_existing_file' || (typeStr === 'unauthorized_app' && (details?.reason?.toLowerCase().includes('pre-existing') || details?.fileName))) {
        const fileTarget = details?.fileName || (details?.reason ? details.reason.split(':').pop().trim() : '');
        const appName = details?.object_class ? ` in ${details.object_class}` : '';
        return fileTarget ? `📂 Pre-Existing File: ${fileTarget}${appName}` : `📂 Pre-Existing File Opened${appName}`;
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
    if (!typeStr) return { key: 'other', label: 'General Alert', icon: '⚠️', color: 'var(--text-muted)', badgeBg: 'var(--bg-muted)' };
    if (typeStr === 'pre_existing_file' || details?.reason?.toLowerCase().includes('pre-existing') || details?.fileName) {
        return { 
            key: 'files',
            label: `📂 Pre-Existing File`, 
            icon: '📂', 
            color: 'var(--warning)', 
            badgeBg: 'var(--warning-soft)' 
        };
    }
    if (typeStr.includes('object') || typeStr.includes('phone') || details?.object_class) {
        const item = details?.object_class ? details.object_class.toLowerCase() : 'Mobile / Object';
        return { 
            key: 'objects',
            label: `📱 ${item.charAt(0).toUpperCase() + item.slice(1)}`, 
            icon: '📱', 
            color: 'var(--danger)', 
            badgeBg: 'var(--danger-soft)' 
        };
    }
    if (typeStr.includes('head') || typeStr.includes('turn') || typeStr.includes('gaze')) {
        return { key: 'head', label: '👤 Head / Gaze Turn', icon: '👤', color: 'var(--warning)', badgeBg: 'var(--warning-soft)' };
    }
    if (typeStr.includes('second_person') || typeStr.includes('multiple_faces')) {
        return { key: 'people', label: '👥 Second Person', icon: '👥', color: 'var(--danger)', badgeBg: 'var(--danger-soft)' };
    }
    if (typeStr.includes('no_face')) {
        return { key: 'noface', label: '👁️ Face Missing', icon: '👁️', color: 'var(--danger)', badgeBg: 'var(--warning-soft)' };
    }
    if (typeStr.includes('app') || typeStr.includes('window')) {
        return { key: 'app', label: '🖥️ App Switch', icon: '🖥️', color: '#4338ca', badgeBg: 'var(--primary-soft)' };
    }
    if (typeStr.includes('camera') || typeStr.includes('dark')) {
        return { key: 'camera', label: '🌑 Camera Feed Dark', icon: '🌑', color: 'var(--text-muted)', badgeBg: 'var(--bg-muted)' };
    }
    return { key: 'other', label: '⚠️ Suspicious Activity', icon: '⚠️', color: 'var(--warning)', badgeBg: 'var(--warning-soft)' };
}

export default function EvidenceViewer({ sessionId, liveViolations = [] }) {
    const { authFetch } = useAuth();
    const [mainTab, setMainTab] = useState('submission'); // 'submission', 'evidence', 'identity'
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sessionData, setSessionData] = useState(null);
    const [submissions, setSubmissions] = useState([]);
    const [copiedSubId, setCopiedSubId] = useState(null);
    const [cameraActionLoading, setCameraActionLoading] = useState(false);
    const [showDismissedLogs, setShowDismissedLogs] = useState(false);

    const handleCopyAnswer = (text, id) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedSubId(id);
        setTimeout(() => setCopiedSubId(null), 2500);
    };

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
                    if (data.length > 0) {
                        setMainTab('submission');
                    }
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
                <div style={{ background: isTerminated ? 'var(--danger-soft)' : 'var(--primary-soft)', border: isTerminated ? '1px solid var(--danger-soft)' : '1px solid var(--primary-soft)', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-main)' }}>
                                Viewing: {studentDisplayName}{rollDisplay}
                            </span>
                            <span className={`md-badge ${isTerminated ? 'status-completed' : 'status-active'}`} style={{ textTransform: 'uppercase', background: isTerminated ? 'var(--danger-bg)' : 'var(--success-bg)', color: 'var(--text-on-color)' }}>
                                {isTerminated ? 'Terminated' : 'Active Live'}
                            </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Exam: <strong>{sessionData?.examId || ''}</strong> &bull; Session: <span title={String(sessionId)} style={{ cursor: 'help' }}>{String(sessionId).substring(0, 8)}...</span>
                            {sessionData?.warnings && sessionData.warnings.length > 0 && ` &bull; Warnings Sent: ${sessionData.warnings.length}`}
                        </div>
                    </div>

                    {!isTerminated ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button 
                                className="md-btn md-btn-sm" 
                                style={{ background: 'var(--bg-surface)', color: 'var(--primary)', border: '1px solid var(--primary)' }}
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
                                style={{ background: 'var(--danger-bg)', color: 'var(--text-on-color)', border: 'none' }}
                                onClick={() => setShowTerminateModal(true)}
                            >
                                <UserX size={14} />
                                <span>Terminate Candidate</span>
                            </button>
                        </div>
                    ) : (
                        <div style={{ color: 'var(--danger)', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <AlertCircle size={14} />
                            <span>Session Terminated: "{sessionData?.terminationReason || 'Integrity Violation'}"</span>
                        </div>
                    )}
                </div>

                {/* Segmented Top Navigation Tabs */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    borderBottom: '2px solid var(--border-color)',
                    paddingBottom: '2px',
                    marginTop: '2px',
                    marginBottom: '4px'
                }}>
                    <button
                        type="button"
                        onClick={() => setMainTab('submission')}
                        style={{
                            background: 'none',
                            border: 'none',
                            borderBottom: mainTab === 'submission' ? '3px solid var(--primary)' : '3px solid transparent',
                            padding: '8px 14px',
                            fontSize: '13.5px',
                            fontWeight: mainTab === 'submission' ? 600 : 500,
                            color: mainTab === 'submission' ? 'var(--primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            transition: 'all 0.15s ease',
                            marginBottom: '-2px'
                        }}
                    >
                        <FileText size={16} />
                        <span>Final Submission</span>
                        <span className="md-badge" style={{
                            fontSize: '11px',
                            padding: '2px 7px',
                            background: submissions.length > 0 ? 'var(--primary-soft)' : 'var(--bg-muted)',
                            color: submissions.length > 0 ? 'var(--primary)' : 'var(--text-muted)'
                        }}>
                            {submissions.length > 0 ? `${submissions.length} Submitted` : 'None'}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setMainTab('evidence')}
                        style={{
                            background: 'none',
                            border: 'none',
                            borderBottom: mainTab === 'evidence' ? '3px solid var(--primary)' : '3px solid transparent',
                            padding: '8px 14px',
                            fontSize: '13.5px',
                            fontWeight: mainTab === 'evidence' ? 600 : 500,
                            color: mainTab === 'evidence' ? 'var(--primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            transition: 'all 0.15s ease',
                            marginBottom: '-2px'
                        }}
                    >
                        <AlertOctagon size={16} />
                        <span>Evidence Timeline</span>
                        <span className="md-badge" style={{
                            fontSize: '11px',
                            padding: '2px 7px',
                            background: activeViolations.length > 0 ? 'var(--danger-soft)' : 'var(--bg-muted)',
                            color: activeViolations.length > 0 ? 'var(--danger)' : 'var(--text-muted)'
                        }}>
                            {activeViolations.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setMainTab('identity')}
                        style={{
                            background: 'none',
                            border: 'none',
                            borderBottom: mainTab === 'identity' ? '3px solid var(--primary)' : '3px solid transparent',
                            padding: '8px 14px',
                            fontSize: '13.5px',
                            fontWeight: mainTab === 'identity' ? 600 : 500,
                            color: mainTab === 'identity' ? 'var(--primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            transition: 'all 0.15s ease',
                            marginBottom: '-2px'
                        }}
                    >
                        <Camera size={16} />
                        <span>Camera & Identity</span>
                        <span className="md-badge" style={{
                            fontSize: '11px',
                            padding: '2px 7px',
                            background: cameraPhotoUrl ? 'var(--success-soft)' : 'var(--bg-muted)',
                            color: cameraPhotoUrl ? 'var(--success)' : 'var(--text-muted)'
                        }}>
                            {cameraPhotoUrl ? 'Verified' : 'No Photo'}
                        </span>
                    </button>
                </div>

                {/* Candidate Exam Submissions Section */}
                {mainTab === 'submission' && (
                    submissions.length > 0 ? (
                        <div className="alert-item" style={{ 
                            background: 'var(--bg-base)', 
                            border: '1.5px solid var(--primary)', 
                            borderRadius: '10px', 
                            padding: '16px 18px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                            marginBottom: '16px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ 
                                        background: 'var(--primary-soft)', 
                                        color: 'var(--primary)', 
                                        width: '36px', 
                                        height: '36px', 
                                        borderRadius: '8px', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center' 
                                    }}>
                                        <FileText size={20} />
                                    </div>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
                                            Candidate Final Answer & Submission
                                        </h4>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                            {submissions[0]?.uploadedAt ? `Submitted on ${new Date(submissions[0].uploadedAt).toLocaleDateString()} at ${new Date(submissions[0].uploadedAt).toLocaleTimeString()}` : 'Official submission recorded'}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <span className="md-badge status-active" style={{ fontSize: '12px', padding: '4px 10px' }}>
                                        <CheckCircle size={13} />
                                        <span>Verified Submission</span>
                                    </span>
                                    {submissions[0]?.submissionType && (
                                        <span className="md-badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: '11px', textTransform: 'uppercase', padding: '4px 8px' }}>
                                            Format: {submissions[0].submissionType}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {submissions.map((sub, idx) => {
                                const isAuto = sub.autoSubmitted || (sub.answerText && sub.answerText.includes('[Auto-Submitted'));
                                const textWords = sub.answerText ? sub.answerText.trim().split(/\s+/).filter(Boolean).length : 0;
                                const textChars = sub.answerText ? sub.answerText.length : 0;

                                return (
                                    <div key={sub._id || idx} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {isAuto && (
                                            <div style={{ 
                                                background: '#fffbeb', 
                                                border: '1px solid #fef3c7', 
                                                color: '#92400e', 
                                                padding: '8px 12px', 
                                                borderRadius: '6px', 
                                                fontSize: '12.5px', 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '8px' 
                                            }}>
                                                <AlertTriangle size={15} style={{ color: '#d97706', flexShrink: 0 }} />
                                                <span><strong>Auto-Finalized on Time Expiry:</strong> Candidate exam was automatically submitted by timer.</span>
                                            </div>
                                        )}

                                        {/* 1. Typed Answer Script Viewer */}
                                        {sub.answerText && (
                                            <div style={{ 
                                                background: 'var(--bg-surface)', 
                                                border: '1px solid var(--border-color)', 
                                                borderRadius: '8px', 
                                                overflow: 'hidden' 
                                            }}>
                                                <div style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    justifyContent: 'space-between', 
                                                    padding: '8px 14px', 
                                                    background: 'var(--bg-muted)', 
                                                    borderBottom: '1px solid var(--border-color)',
                                                    fontSize: '12.5px',
                                                    fontWeight: 600,
                                                    color: 'var(--text-main)'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <FileCode size={15} style={{ color: 'var(--primary)' }} />
                                                        <span>Typed Response Script</span>
                                                        <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 400 }}>
                                                            ({textWords} words • {textChars} characters)
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyAnswer(sub.answerText, sub._id || idx)}
                                                        className="md-btn md-btn-sm md-btn-outlined"
                                                        style={{ fontSize: '11px', padding: '3px 8px', gap: '4px', display: 'inline-flex', alignItems: 'center' }}
                                                    >
                                                        {copiedSubId === (sub._id || idx) ? (
                                                            <>
                                                                <CheckCheck size={12} style={{ color: 'var(--success)' }} />
                                                                <span style={{ color: 'var(--success)' }}>Copied!</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Copy size={12} />
                                                                <span>Copy Answer</span>
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                                <div style={{ 
                                                    padding: '14px 16px', 
                                                    whiteSpace: 'pre-wrap', 
                                                    fontFamily: 'inherit', 
                                                    fontSize: '13.5px', 
                                                    lineHeight: 1.65, 
                                                    color: 'var(--text-main)', 
                                                    maxHeight: '340px', 
                                                    overflowY: 'auto',
                                                    userSelect: 'text'
                                                }}>
                                                    {sub.answerText}
                                                </div>
                                            </div>
                                        )}

                                        {/* 2. Attached File Card */}
                                        {(sub.filePath || sub.filename) && (
                                            <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'space-between', 
                                                background: 'var(--bg-surface)', 
                                                border: '1px solid var(--border-color)', 
                                                borderRadius: '8px', 
                                                padding: '12px 16px',
                                                flexWrap: 'wrap',
                                                gap: '10px'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <div style={{ 
                                                        background: 'var(--primary-soft)', 
                                                        color: 'var(--primary)', 
                                                        width: '34px', 
                                                        height: '34px', 
                                                        borderRadius: '6px', 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        justifyContent: 'center',
                                                        fontSize: '16px'
                                                    }}>
                                                        📄
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-main)' }}>
                                                            {sub.filename || 'Candidate Solution Document'}
                                                        </div>
                                                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                            {sub.fileSize ? `${(sub.fileSize / 1024).toFixed(1)} KB` : 'Uploaded Attachment'} • Attached during exam
                                                        </div>
                                                    </div>
                                                </div>

                                                {sub.filePath && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <a 
                                                            href={assetUrl(sub.filePath.startsWith('http') ? sub.filePath : `${API_BASE_URL}${sub.filePath}`)}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="md-btn md-btn-sm md-btn-outlined"
                                                            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                                                        >
                                                            <ExternalLink size={13} />
                                                            <span>Preview</span>
                                                        </a>
                                                        <a 
                                                            href={assetUrl(sub.filePath.startsWith('http') ? sub.filePath : `${API_BASE_URL}${sub.filePath}`)}
                                                            download={sub.filename || 'candidate_solution'}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="md-btn md-btn-sm md-btn-primary"
                                                            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                                                        >
                                                            <Download size={13} />
                                                            <span>Download Solution File</span>
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="md-empty-card" style={{ padding: '36px 20px', textAlign: 'center', background: 'var(--bg-base)', borderRadius: '10px', border: '1px dashed var(--border-color)', margin: '10px 0 16px' }}>
                            <FileText size={36} style={{ color: 'var(--text-muted)', margin: '0 auto 10px', display: 'block' }} />
                            <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', color: 'var(--text-main)' }}>No Submission Recorded</h4>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                                Candidate has not uploaded any solution files or submitted typed responses yet.
                            </p>
                        </div>
                    )
                )}

                {/* TAB 2: Evidence Timeline & Incidents */}
                {mainTab === 'evidence' && (
                    <>
                        {/* Categorized Filter & Accordion Toolbar */}
                        <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    flexWrap: 'wrap',
                    gap: '8px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Filter size={15} style={{ color: 'var(--text-muted)' }} />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
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
                        <CheckCircle size={36} style={{ color: 'var(--success)', marginBottom: '8px' }} />
                        <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--text-main)' }}>No Active Violations Found</h4>
                        <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '12.5px' }}>
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
                                        border: `1px solid ${bundle.maxSeverity >= 4 ? 'var(--danger-soft)' : 'var(--border-color)'}`,
                                        borderLeft: `5px solid ${bundle.color}`,
                                        padding: 0,
                                        overflow: 'hidden',
                                        background: 'var(--bg-surface)'
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
                                            borderBottom: isExpanded ? '1px solid var(--border-color)' : 'none',
                                            userSelect: 'none'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ fontSize: '18px' }}>{bundle.icon}</span>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-main)' }}>
                                                        {bundle.label}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        color: bundle.color,
                                                        background: 'var(--bg-surface)',
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
                                                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                    Latest: {new Date(bundle.latestTimestamp).toLocaleTimeString()} &bull; Severity: {bundle.maxSeverity} &bull; {snapshots.length} Snapshots
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--primary)' }}>
                                                {isExpanded ? 'Collapse Category' : `Expand (${bundle.items.length})`}
                                            </span>
                                            {isExpanded ? <ChevronUp size={16} color="var(--primary)" /> : <ChevronDown size={16} color="var(--primary)" />}
                                        </div>
                                    </div>

                                    {/* Accordion Body: Evidence Snapshots & Decisions */}
                                    {isExpanded && (
                                        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--bg-base)' }}>
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
                                                            background: isReviewed ? 'var(--bg-base)' : 'var(--bg-surface)',
                                                            border: isReviewed ? '1px solid var(--border-color)' : '1px solid var(--primary)',
                                                            borderRadius: '6px',
                                                            padding: '10px 14px'
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-main)' }}>
                                                                    #{vIdx + 1} &bull; {formatType(v.type, v.details)}
                                                                </span>
                                                                <span className="md-badge" style={{ fontSize: '10.5px' }}>
                                                                    Sev {v.severity}
                                                                </span>
                                                                {v.details?.confidence && (
                                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                                        ({Math.round(v.details.confidence * 100)}% conf)
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
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
                                                            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '6px' }}>
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
                                                                    border: '1px solid var(--border-color)', 
                                                                    background: '#000',
                                                                    position: 'relative',
                                                                    cursor: 'pointer',
                                                                    maxHeight: '220px'
                                                                }}
                                                                onClick={() => setModalImageSrc(assetUrl(imageSrc))}
                                                                title="Click to zoom full screenshot"
                                                            >
                                                                <img 
                                                                    src={assetUrl(imageSrc)} 
                                                                    alt="Violation Evidence" 
                                                                    style={{ width: '100%', maxHeight: '220px', objectFit: 'contain', display: 'block' }} 
                                                                />
                                                                <span style={{
                                                                    position: 'absolute',
                                                                    bottom: 6,
                                                                    right: 6,
                                                                    background: 'rgba(0,0,0,0.7)',
                                                                    color: 'var(--text-on-color)',
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
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--bg-muted)', paddingTop: '6px' }}>
                                                            <button 
                                                                className="md-btn md-btn-sm" 
                                                                style={{ background: decision === 'confirmed' ? 'var(--success-soft)' : 'var(--bg-muted)', color: decision === 'confirmed' ? 'var(--success)' : 'var(--text-muted)', border: '1px solid var(--border-color)', fontSize: '11.5px', padding: '3px 8px' }}
                                                                onClick={() => handleReviewAction(v._id, 'confirmed')}
                                                            >
                                                                <Check size={12} />
                                                                <span>Confirm</span>
                                                            </button>
                                                            <button 
                                                                className="md-btn md-btn-sm" 
                                                                style={{ background: 'var(--bg-surface)', color: 'var(--danger)', border: '1px solid var(--danger-soft)', fontSize: '11.5px', padding: '3px 8px' }}
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
                                        background: isReviewed ? 'var(--bg-base)' : 'var(--bg-surface)',
                                        border: isReviewed ? '1px solid var(--border-color)' : '1px solid var(--primary)'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <div>
                                            <span style={{ fontWeight: 600, fontSize: '14.5px', color: 'var(--text-main)' }}>
                                                {formatType(v.type, v.details)}
                                            </span>
                                            <span className="md-badge" style={{ fontSize: '11px', background: 'var(--bg-muted)', marginLeft: '8px' }}>
                                                Severity {v.severity}
                                            </span>
                                        </div>
                                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                            {new Date(v.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>

                                    {imageSrc && (
                                        <div 
                                            style={{ marginTop: '8px', marginBottom: '10px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)', background: '#000', cursor: 'pointer' }}
                                            onClick={() => setModalImageSrc(assetUrl(imageSrc))}
                                        >
                                            <img 
                                                src={assetUrl(imageSrc)} 
                                                alt="Evidence Snapshot" 
                                                style={{ width: '100%', maxHeight: '280px', objectFit: 'contain', display: 'block' }} 
                                            />
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                                        <button 
                                            className="md-btn md-btn-sm" 
                                            style={{ background: decision === 'confirmed' ? 'var(--success-soft)' : 'var(--bg-muted)', color: decision === 'confirmed' ? 'var(--success)' : 'var(--text-muted)', border: '1px solid var(--border-color)' }}
                                            onClick={() => handleReviewAction(v._id, 'confirmed')}
                                        >
                                            <Check size={14} />
                                            <span>Confirm</span>
                                        </button>
                                        <button 
                                            className="md-btn md-btn-sm" 
                                            style={{ background: 'var(--bg-surface)', color: 'var(--danger)', border: '1px solid var(--danger-soft)' }}
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
                    <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                        <button 
                            type="button"
                            className="md-btn md-btn-sm md-btn-text"
                            onClick={() => setShowDismissedLogs(!showDismissedLogs)}
                            style={{ color: 'var(--text-muted)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', cursor: 'pointer' }}
                        >
                            <Clock size={13} />
                            <span>{showDismissedLogs ? 'Hide' : 'View'} Dismissed Logs ({dismissedViolations.length})</span>
                        </button>

                        {showDismissedLogs && (
                            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {dismissedViolations.map(dv => (
                                    <div key={dv._id} style={{ background: 'var(--bg-base)', border: '1px dashed var(--border-color)', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div>
                                            <strong>{formatType(dv.type, dv.details)}</strong> (Severity {dv.severity}) • {new Date(dv.timestamp).toLocaleTimeString()}
                                        </div>
                                        <span className="md-badge" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)', fontSize: '10px' }}>
                                            Dismissed
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                    </>
                )}

                {/* TAB 3: Pre-Exam Camera & Identity Verification */}
                {mainTab === 'identity' && (
                    <div className="alert-item" style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        padding: '18px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px',
                        marginBottom: '16px'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{ background: 'var(--primary-soft)', color: 'var(--primary)', width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Camera size={20} />
                                </div>
                                <div>
                                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
                                        Candidate Pre-Exam Identity Verification
                                    </h4>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                        Live camera snapshot captured during the self-check verification stage.
                                    </div>
                                </div>
                            </div>
                            <span className="md-badge" style={{
                                background: cameraPhotoUrl ? 'var(--success-soft)' : 'var(--warning-soft)',
                                color: cameraPhotoUrl ? 'var(--success)' : 'var(--warning)',
                                fontSize: '12px',
                                padding: '4px 10px'
                            }}>
                                {cameraPhotoUrl ? '✓ Photo Verified' : 'No Verification Photo'}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: cameraPhotoUrl ? '280px 1fr' : '1fr', gap: '20px', alignItems: 'start' }}>
                            {cameraPhotoUrl ? (
                                <div 
                                    style={{
                                        borderRadius: '8px',
                                        overflow: 'hidden',
                                        border: '1px solid var(--border-color)',
                                        background: '#000',
                                        cursor: 'pointer',
                                        position: 'relative'
                                    }}
                                    onClick={() => setModalImageSrc(cameraPhotoUrl)}
                                    title="Click to enlarge verification photo"
                                >
                                    <img 
                                        src={cameraPhotoUrl} 
                                        alt="Candidate Verification Photo" 
                                        style={{ width: '100%', maxHeight: '220px', objectFit: 'contain', display: 'block' }}
                                    />
                                    <div style={{
                                        position: 'absolute',
                                        bottom: '8px',
                                        right: '8px',
                                        background: 'rgba(0,0,0,0.65)',
                                        color: '#fff',
                                        borderRadius: '4px',
                                        padding: '3px 6px',
                                        fontSize: '11px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}>
                                        <Maximize2 size={12} />
                                        <span>Enlarge</span>
                                    </div>
                                </div>
                            ) : (
                                <div style={{
                                    padding: '28px 20px',
                                    background: 'var(--bg-base)',
                                    borderRadius: '8px',
                                    border: '1px dashed var(--border-color)',
                                    textAlign: 'center',
                                    color: 'var(--text-muted)',
                                    fontSize: '13px'
                                }}>
                                    No pre-exam verification snapshot was recorded for this session.
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ background: 'var(--bg-base)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Candidate Name</div>
                                    <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>{studentDisplayName}</div>
                                </div>

                                <div style={{ background: 'var(--bg-base)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Roll Number / ID</div>
                                    <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>{sessionData?.rollNumber || sessionData?.studentId || 'N/A'}</div>
                                </div>

                                <div style={{ background: 'var(--bg-base)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Exam ID</div>
                                    <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-main)', marginTop: '2px' }}>{sessionData?.examId || 'N/A'}</div>
                                </div>

                                <div style={{ background: 'var(--bg-base)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Session ID</div>
                                    <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-muted)', marginTop: '2px' }}>{sessionId}</div>
                                </div>
                            </div>
                        </div>
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', color: 'var(--text-on-color)' }}>
                            <span style={{ fontSize: '13px', fontWeight: 500 }}>High-Resolution Evidence Snapshot</span>
                            <button 
                                onClick={() => setModalImageSrc(null)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-on-color)', cursor: 'pointer', padding: '4px' }}
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
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)' }}>
                                <MessageSquare size={18} /> Send Warning to Candidate
                            </h3>
                            <button className="md-icon-btn" onClick={() => setShowWarnModal(false)}>
                                <X size={20} />
                            </button>
                        </div>

                        {warnSuccess ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--success)' }}>
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
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)' }}>
                                <AlertOctagon size={18} /> Terminate Candidate Session
                            </h3>
                            <button className="md-icon-btn" onClick={() => setShowTerminateModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleTerminate}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 16px 0' }}>
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
                                    style={{ background: 'var(--danger-bg)', color: 'var(--text-on-color)' }}
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
