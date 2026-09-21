import React, { useEffect, useState } from 'react';
import { getViolations } from '../services/api';
import { 
    Check, X, Clock, CheckCircle, XCircle, Eye, Camera, AlertTriangle, 
    ShieldCheck, FileText, Download, Paperclip, AlertOctagon, MessageSquare, 
    Send, UserX, AlertCircle 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Components.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function formatType(typeStr) {
    if (!typeStr) return "Unknown";
    return typeStr.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function EvidenceViewer({ sessionId, liveViolations = [] }) {
    const { authFetch } = useAuth();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sessionData, setSessionData] = useState(null);
    const [submissions, setSubmissions] = useState([]);
    const [cameraActionLoading, setCameraActionLoading] = useState(false);
    const [showDismissedLogs, setShowDismissedLogs] = useState(false);

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
                const liveSid = String(liveV.sessionId || liveV.session_id || '');
                if (liveSid === String(sessionId)) {
                    const liveId = String(liveV._id || liveV.id);
                    const index = updated.findIndex(item => String(item._id || item.id) === liveId);

                    if (index >= 0) {
                        if (JSON.stringify(updated[index]) !== JSON.stringify(liveV)) {
                            updated[index] = { ...updated[index], ...liveV };
                            hasChanges = true;
                        }
                    } else {
                        updated = [liveV, ...updated];
                        hasChanges = true;
                    }
                }
            });

            return hasChanges ? updated : prev;
        });
    }, [liveViolations, sessionId]);

    const handleSendWarning = async (e) => {
        e.preventDefault();
        if (!sessionId || !warnMessage.trim()) return;

        setActionSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sessionId}/warn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: warnMessage.trim() })
            });

            if (res.ok) {
                setWarnSuccess(true);
                setTimeout(() => {
                    setShowWarnModal(false);
                    setWarnSuccess(false);
                    setWarnMessage('');
                }, 1200);
                fetchSessionData();
            }
        } catch (err) {
            console.error('Failed to send warning:', err);
        } finally {
            setActionSubmitting(false);
        }
    };

    const handleTerminateCandidate = async (e) => {
        e.preventDefault();
        if (!sessionId) return;

        setActionSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sessionId}/terminate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    reason: terminateReason.trim() || 'Terminated by examiner for integrity policy violation' 
                })
            });

            if (res.ok) {
                const data = await res.json();
                setSessionData(data.session);
                setShowTerminateModal(false);
                fetchSessionData();
            }
        } catch (err) {
            console.error('Failed to terminate candidate:', err);
        } finally {
            setActionSubmitting(false);
        }
    };

    const handleReviewAction = async (violationId, decision) => {
        // Optimistically update local history immediately
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

        // Optimistically update session camera verification status
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
                fetchHistory(); // Refresh violations in case camera issue was flagged
            }
        } catch (err) {
            console.error('Error updating camera verification:', err);
        } finally {
            setCameraActionLoading(false);
        }
    };

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
        ? `${API_BASE_URL.replace(/\/$/, '')}/${sessionData.cameraVerificationPhoto.replace(/^\//, '')}`
        : null;
    const cameraStatus = sessionData?.cameraVerificationStatus || 'none';
    const isTerminated = sessionData?.status === 'terminated';

    const studentDisplayName = sessionData?.studentName || sessionData?.studentId || 'Candidate';
    const rollDisplay = sessionData?.rollNumber ? ` (${sessionData.rollNumber})` : (sessionData?.studentId && sessionData.studentId !== sessionData.studentName ? ` (${sessionData.studentId})` : '');

    return (
        <div className="md-card evidence-card" style={{ overflowY: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

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
                            <span>Session Terminated by Examiner: "{sessionData?.terminationReason || 'Integrity Violation'}"</span>
                        </div>
                    )}
                </div>

                {/* Candidate Exam Submissions Section */}
                {submissions.length > 0 && (
                    <div className="alert-item" style={{ background: '#f8f9fa', border: '1px solid #1a73e8', borderRadius: '8px', padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FileText size={18} style={{ color: '#1a73e8' }} />
                                <span style={{ fontWeight: 600, fontSize: '15px', color: '#202124' }}>
                                    Candidate Answer Submission
                                </span>
                            </div>
                            <span className="md-badge status-active">
                                <CheckCircle size={12} />
                                <span>Submitted</span>
                            </span>
                        </div>

                        {submissions.map((sub, idx) => {
                            const fileUrl = sub.filePath 
                                ? `${API_BASE_URL.replace(/\/$/, '')}/${sub.filePath.replace(/^\//, '')}`
                                : null;

                            return (
                                <div key={sub._id || idx} style={{ background: '#ffffff', border: '1px solid #dadce0', borderRadius: '6px', padding: '12px', marginBottom: idx < submissions.length - 1 ? '10px' : '0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: '#5f6368' }}>
                                        <span>Type: <strong style={{ color: '#202124', textTransform: 'capitalize' }}>{sub.submissionType}</strong></span>
                                        <span>Uploaded: {new Date(sub.uploadedAt).toLocaleString()}</span>
                                    </div>

                                    {/* Typed Answer Text */}
                                    {sub.answerText && (
                                        <div style={{ marginBottom: sub.filename ? '12px' : '0' }}>
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#3c4043', marginBottom: '4px' }}>Typed Answer:</div>
                                            <div style={{ background: '#f8f9fa', border: '1px solid #e8eaed', padding: '10px 12px', borderRadius: '6px', fontSize: '13px', color: '#202124', whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: '200px', overflowY: 'auto' }}>
                                                {sub.answerText}
                                            </div>
                                        </div>
                                    )}

                                    {/* Attached File Download */}
                                    {sub.filename && fileUrl && (
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#e8f0fe', padding: '10px 12px', borderRadius: '6px', border: '1px solid #c2e7ff' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                                <Paperclip size={16} style={{ color: '#1a73e8', flexShrink: 0 }} />
                                                <span style={{ fontSize: '13px', fontWeight: 500, color: '#1a73e8', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                                    {sub.filename}
                                                </span>
                                            </div>
                                            <a 
                                                href={fileUrl} 
                                                target="_blank" 
                                                rel="noreferrer" 
                                                className="md-btn md-btn-primary md-btn-sm"
                                                style={{ textDecoration: 'none', flexShrink: 0 }}
                                            >
                                                <Download size={13} />
                                                <span>Download File</span>
                                            </a>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Candidate Camera Start Verification Photo Card (disappears completely once verified) */}
                {cameraPhotoUrl && cameraStatus !== 'verified' && (
                    <div className="alert-item" style={{ background: '#f8f9fa', border: '1px solid #dadce0', borderRadius: '8px', padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Camera size={18} style={{ color: '#1a73e8' }} />
                                <span style={{ fontWeight: 600, fontSize: '14px', color: '#202124' }}>
                                    Initial Camera Check Photo (Pending Identity Confirmation)
                                </span>
                            </div>

                            <span className="md-badge status-draft">
                                <Clock size={12} />
                                <span>Self-Check Snapshot</span>
                            </span>
                        </div>

                        <div style={{ borderRadius: '6px', overflow: 'hidden', border: '1px solid #dadce0', background: '#000', marginBottom: '12px' }}>
                            <img 
                                src={cameraPhotoUrl} 
                                alt="Candidate Initial Camera Check" 
                                style={{ width: '100%', maxHeight: '240px', objectFit: 'contain', display: 'block' }} 
                            />
                        </div>

                        {/* Teacher Camera Verification Action Controls */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', borderTop: '1px solid #e8eaed', paddingTop: '10px' }}>
                            <span style={{ fontSize: '12px', color: '#5f6368' }}>
                                Confirm student identity to verify candidate and clear photo from screen.
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button 
                                    className="md-btn md-btn-sm"
                                    style={{ background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }}
                                    onClick={() => handleCameraVerificationAction('verified')}
                                    disabled={cameraActionLoading}
                                >
                                    <Check size={14} />
                                    <span>{cameraActionLoading ? 'Verifying...' : 'Confirm Identity & Camera'}</span>
                                </button>
                                <button 
                                    className="md-btn md-btn-sm"
                                    style={{ background: '#fce8e6', color: '#d93025', border: '1px solid #fad2cf' }}
                                    onClick={() => handleCameraVerificationAction('flagged', 'Camera covered, dark, or invalid feed')}
                                    disabled={cameraActionLoading}
                                >
                                    <AlertTriangle size={14} />
                                    <span>Flag Camera Issue</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* If already verified, show a clean, compact confirmation banner */}
                {cameraStatus === 'verified' && (
                    <div style={{ background: '#e6f4ea', border: '1px solid #ceead6', borderRadius: '6px', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#137333', fontSize: '13px', fontWeight: 500 }}>
                            <ShieldCheck size={18} />
                            <span>Candidate Identity & Webcam Verified</span>
                        </div>
                        <span style={{ fontSize: '11px', color: '#137333', background: '#ffffff', padding: '2px 8px', borderRadius: '10px', border: '1px solid #ceead6' }}>
                            Verified Active
                        </span>
                    </div>
                )}

                {/* Active Violations Timeline (excludes dismissed violations from active view) */}
                {(() => {
                    const activeViolations = history.filter(v => v.decision !== 'dismissed');
                    const dismissedViolations = history.filter(v => v.decision === 'dismissed');

                    return (
                        <>
                            {activeViolations.length === 0 ? (
                                <div className="md-empty-card" style={{ border: 'none', background: 'transparent' }}>
                                    <CheckCircle size={36} style={{ color: '#188038', marginBottom: '12px' }} />
                                    <h3 style={{ margin: 0 }}>No Active Violations</h3>
                                    <p style={{ margin: '4px 0 0 0', color: '#5f6368', fontSize: '13px' }}>
                                        {dismissedViolations.length > 0 
                                            ? `${dismissedViolations.length} alert(s) were dismissed as false positives.` 
                                            : 'This candidate has maintained clean monitoring status.'}
                                    </p>
                                </div>
                            ) : (
                                activeViolations.map(v => {
                                    const isReviewed = Boolean(v.reviewed);
                                    const decision = v.decision || 'pending';
                                    const imageSrc = v.screenshotPath 
                                        ? `${API_BASE_URL.replace(/\/$/, '')}/${v.screenshotPath.replace(/^\//, '')}`
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
                                                    <span style={{ fontWeight: 600, fontSize: '15px', color: '#202124' }}>
                                                        {formatType(v.type)}
                                                    </span>
                                                    <span className="md-badge" style={{ fontSize: '11px', background: '#f1f3f4', marginLeft: '8px' }}>
                                                        Severity {v.severity}
                                                    </span>
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '12px', color: '#70757a' }}>
                                                        {new Date(v.timestamp).toLocaleTimeString()}
                                                    </span>
                                                    {isReviewed ? (
                                                        <span className={`md-badge ${decision === 'confirmed' ? 'status-active' : 'status-completed'}`}>
                                                            {decision === 'confirmed' ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                            <span style={{ textTransform: 'capitalize' }}>{decision}</span>
                                                        </span>
                                                    ) : (
                                                        <span className="md-badge status-draft">
                                                            <Clock size={12} />
                                                            <span>Needs Review</span>
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {v.details && (
                                                <div style={{ fontSize: '12px', color: '#5f6368', fontFamily: 'monospace', marginBottom: '10px' }}>
                                                    {v.details.confidence && <span>Confidence: {Math.round(v.details.confidence * 100)}% • </span>}
                                                    {v.details.duration && <span>Duration: {v.details.duration.toFixed(1)}s • </span>}
                                                    {v.details.object_class && <span>Target: {v.details.object_class} • </span>}
                                                    {v.details.reason && <span>Details: {v.details.reason}</span>}
                                                </div>
                                            )}

                                            {v.reviewNote && (
                                                <div style={{ fontSize: '12px', color: '#3c4043', background: '#f1f3f4', padding: '6px 10px', borderRadius: '4px', marginBottom: '10px', fontStyle: 'italic' }}>
                                                    Review Note: "{v.reviewNote}"
                                                </div>
                                            )}

                                            {imageSrc && (
                                                <div style={{ marginTop: '8px', marginBottom: '10px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #dadce0', background: '#000' }}>
                                                    <img 
                                                        src={imageSrc} 
                                                        alt="Violation Evidence Screenshot" 
                                                        style={{ width: '100%', maxHeight: '320px', objectFit: 'contain', display: 'block' }} 
                                                    />
                                                </div>
                                            )}

                                            {/* Triage controls inside timeline */}
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #f1f3f4', paddingTop: '8px' }}>
                                                <button 
                                                    className="md-btn md-btn-sm" 
                                                    style={{ background: decision === 'confirmed' ? '#e6f4ea' : '#f1f3f4', color: decision === 'confirmed' ? '#137333' : '#5f6368', border: '1px solid #dadce0' }}
                                                    onClick={() => handleReviewAction(v._id, 'confirmed')}
                                                    title="Confirm that this alert is a valid violation"
                                                >
                                                    <Check size={14} />
                                                    <span>Confirm Violation</span>
                                                </button>
                                                <button 
                                                    className="md-btn md-btn-sm" 
                                                    style={{ background: '#ffffff', color: '#d93025', border: '1px solid #fad2cf' }}
                                                    onClick={() => handleReviewAction(v._id, 'dismissed')}
                                                    title="Dismiss this alert as false positive and reduce candidate risk score"
                                                >
                                                    <X size={14} />
                                                    <span>Dismiss Alert (Reduce Score)</span>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
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
                                        <span>{showDismissedLogs ? 'Hide' : 'View'} Dismissed / False Positive Logs ({dismissedViolations.length})</span>
                                    </button>

                                    {showDismissedLogs && (
                                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {dismissedViolations.map(dv => (
                                                <div key={dv._id} style={{ background: '#f8f9fa', border: '1px dashed #dadce0', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: '#5f6368', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <div>
                                                        <strong>{formatType(dv.type)}</strong> (Severity {dv.severity}) • {new Date(dv.timestamp).toLocaleTimeString()}
                                                        {dv.details?.object_class && ` • Target: ${dv.details.object_class}`}
                                                    </div>
                                                    <span className="md-badge" style={{ background: '#e8eaed', color: '#5f6368', fontSize: '10px' }}>
                                                        Dismissed by Examiner
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    );
                })()}
            </div>

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
                                        onChange={(e) => {
                                            if (e.target.value) setWarnMessage(e.target.value);
                                        }}
                                    >
                                        <option value="Please remain facing the camera directly at all times.">📷 Face Camera Warning</option>
                                        <option value="Close all unauthorized background applications immediately.">🖥️ Unauthorized App Warning</option>
                                        <option value="Remove mobile phones and unauthorized items from your workstation.">📱 Mobile Device Warning</option>
                                        <option value="Multiple persons detected in your camera field of view. Please ensure you are alone.">👥 Second Person Warning</option>
                                    </select>
                                    <textarea 
                                        className="md-input" 
                                        rows="3" 
                                        value={warnMessage} 
                                        onChange={(e) => setWarnMessage(e.target.value)} 
                                        placeholder="Type warning message for candidate..."
                                        required 
                                    />
                                </div>

                                <div className="md-modal-actions">
                                    <button type="button" className="md-btn md-btn-text" onClick={() => setShowWarnModal(false)}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="md-btn md-btn-primary" disabled={actionSubmitting}>
                                        <Send size={14} />
                                        <span>{actionSubmitting ? 'Sending...' : 'Send Warning'}</span>
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
                        <div className="md-modal-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d93025' }}>
                                <AlertOctagon size={20} /> Terminate Candidate Session?
                            </h3>
                            <button className="md-icon-btn" onClick={() => setShowTerminateModal(false)}>
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleTerminateCandidate}>
                            <div style={{ padding: '12px 0 16px 0', fontSize: '14px', color: '#5f6368', lineHeight: '1.5' }}>
                                Terminate candidate <strong>"{sessionData?.studentId || 'Candidate'}"</strong>?
                                <p style={{ marginTop: '6px', color: '#d93025', fontWeight: 500 }}>
                                    This will immediately lock the candidate's exam screen and prevent further answer submission.
                                </p>
                            </div>

                            <div className="md-form-group">
                                <label>Termination Reason *</label>
                                <textarea 
                                    className="md-input" 
                                    rows="2" 
                                    value={terminateReason} 
                                    onChange={(e) => setTerminateReason(e.target.value)} 
                                    placeholder="e.g. Unresponsive to multiple warnings / Confirmed unauthorized phone usage..."
                                />
                            </div>

                            <div className="md-modal-actions">
                                <button type="button" className="md-btn md-btn-text" onClick={() => setShowTerminateModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="md-btn md-btn-danger" disabled={actionSubmitting}>
                                    <UserX size={14} />
                                    <span>{actionSubmitting ? 'Terminating...' : 'Confirm Termination'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}