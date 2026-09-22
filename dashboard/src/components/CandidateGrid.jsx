import React, { useEffect, useState } from 'react';
import { getActiveSessions } from '../services/api';
import RiskScoreBadge from './RiskScoreBadge';
import { 
    Users, Camera, Eye, MessageSquare, UserX, AlertTriangle, 
    ShieldCheck, Clock, RefreshCw, Grid, Check 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Components.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function CandidateGrid({ riskScores = {}, violations = [], onSelectCandidate, examFilter }) {
    const { authFetch } = useAuth();
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [verifyingMap, setVerifyingMap] = useState({});

    const fetchSessions = () => {
        getActiveSessions()
            .then(res => {
                setSessions(res.data);
                setLoading(false);
            })
            .catch(err => {
                console.error("Error fetching candidate grid sessions:", err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchSessions();
        const interval = setInterval(fetchSessions, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleConfirmIdentity = async (sid, e) => {
        if (e) e.stopPropagation();
        if (!sid) return;

        // Optimistically mark verified
        setSessions(prev => prev.map(s => {
            const currentId = s.sessionId || s._id;
            if (currentId === sid) {
                return { ...s, cameraVerificationStatus: 'verified' };
            }
            return s;
        }));

        setVerifyingMap(prev => ({ ...prev, [sid]: true }));

        try {
            const res = await authFetch(`${API_BASE_URL}/sessions/${sid}/camera-verification`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'verified' })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.session) {
                    setSessions(prev => prev.map(s => {
                        const currentId = s.sessionId || s._id;
                        if (currentId === sid) {
                            return { ...s, ...data.session };
                        }
                        return s;
                    }));
                }
            }
        } catch (err) {
            console.error('Failed to verify identity:', err);
        } finally {
            setVerifyingMap(prev => ({ ...prev, [sid]: false }));
        }
    };

    // Filter sessions by examFilter if selected
    const filteredSessions = sessions.filter(s => {
        if (examFilter && s.examId && s.examId.toUpperCase() !== examFilter.toUpperCase()) {
            return false;
        }
        return true;
    });

    // Count unreviewed violations per candidate
    const unreviewedBySession = (violations || []).reduce((acc, v) => {
        if (!v.reviewed && v.sessionId && v.decision !== 'dismissed') {
            acc[v.sessionId] = (acc[v.sessionId] || 0) + 1;
        }
        return acc;
    }, {});

    if (loading) {
        return (
            <div className="md-card candidate-grid-card">
                <div className="md-loading">
                    <RefreshCw size={24} className="spin" />
                    <span>Loading candidate webcam grid...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="md-card candidate-grid-card" style={{ overflowY: 'auto', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Grid size={18} style={{ color: '#1a73e8' }} />
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#202124' }}>
                        Live Candidate Webcam Grid
                    </h3>
                </div>
                <span className="md-badge status-active">
                    <Users size={12} />
                    <span>{filteredSessions.length} Active Candidates</span>
                </span>
            </div>

            {filteredSessions.length === 0 ? (
                <div className="md-empty-card" style={{ border: 'none', background: 'transparent' }}>
                    <Users size={40} className="md-empty-icon" />
                    <p style={{ margin: 0 }}>No active candidate sessions found.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
                    {filteredSessions.map((s) => {
                        const sid = s.sessionId || s._id;
                        const currentScore = riskScores[sid] !== undefined ? riskScores[sid] : s.riskScore;
                        const pendingAlerts = unreviewedBySession[sid] || 0;
                        const cameraStatus = s.cameraVerificationStatus || 'none';
                        const isVerified = cameraStatus === 'verified';
                        const photoUrl = s.cameraVerificationPhoto 
                            ? (s.cameraVerificationPhoto.startsWith('http://') || s.cameraVerificationPhoto.startsWith('https://')
                                ? s.cameraVerificationPhoto
                                : `${API_BASE_URL.replace(/\/$/, '')}/${s.cameraVerificationPhoto.replace(/^\//, '')}`)
                            : null;
                        const isVerifying = verifyingMap[sid] || false;

                        return (
                            <div 
                                key={sid}
                                className="md-card candidate-webcam-card"
                                style={{
                                    border: currentScore >= 60 ? '2px solid #d93025' : currentScore >= 30 ? '2px solid #f9ab00' : '1px solid #dadce0',
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    background: '#ffffff',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    boxShadow: '0 1px 3px rgba(60,64,67,0.12)'
                                }}
                            >
                                {/* Card Header */}
                                <div style={{ padding: '10px 12px', background: '#f8f9fa', borderBottom: '1px solid #dadce0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#202124' }}>
                                            {s.studentName || s.studentId || 'Candidate'}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#5f6368' }}>
                                            {s.rollNumber ? `${s.rollNumber} • ` : ''}Code: {s.examId}
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {pendingAlerts > 0 && (
                                            <span className="md-badge status-draft" style={{ fontSize: '10px', padding: '1px 5px' }}>
                                                {pendingAlerts} New
                                            </span>
                                        )}
                                        <RiskScoreBadge score={currentScore} />
                                    </div>
                                </div>

                                {/* Webcam / Verification Area */}
                                <div style={{ height: '160px', background: '#0f172a', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {/* If NOT verified yet and photo exists, show the self-check photo for verification */}
                                    {!isVerified && photoUrl ? (
                                        <img 
                                            src={photoUrl} 
                                            alt={`Self-check photo ${s.studentId}`} 
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                        />
                                    ) : isVerified ? (
                                        /* Once verified, photo disappears cleanly and displays active live monitoring feed */
                                        <div style={{ textAlign: 'center', color: '#10b981', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <ShieldCheck size={36} style={{ color: '#10b981' }} />
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>Identity Verified</div>
                                            <div style={{ fontSize: '10px', color: '#94a3b8' }}>Camera Active ● Live</div>
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', color: '#64748b' }}>
                                            <Camera size={32} style={{ marginBottom: '4px', opacity: 0.6 }} />
                                            <div style={{ fontSize: '11px' }}>Camera Active</div>
                                        </div>
                                    )}

                                    {/* Verification Badge Overlay */}
                                    <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', padding: '2px 8px', borderRadius: '12px', color: '#fff', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        {isVerified ? <ShieldCheck size={11} style={{ color: '#34d399' }} /> : <Clock size={11} style={{ color: '#fbbf24' }} />}
                                        <span style={{ textTransform: 'capitalize' }}>{isVerified ? 'Identity Confirmed' : 'Self-Check Check Required'}</span>
                                    </div>
                                </div>

                                {/* Action Buttons Footer */}
                                <div style={{ padding: '8px 12px', background: '#ffffff', borderTop: '1px solid #e8eaed', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                                    {!isVerified && photoUrl && (
                                        <button 
                                            className="md-btn md-btn-sm"
                                            style={{ flex: 1, fontSize: '11px', padding: '4px 6px', background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }}
                                            onClick={(e) => handleConfirmIdentity(sid, e)}
                                            disabled={isVerifying}
                                            title="Confirm student identity and clear self-check photo"
                                        >
                                            <Check size={12} />
                                            <span>{isVerifying ? 'Confirming...' : 'Confirm Identity'}</span>
                                        </button>
                                    )}

                                    <button 
                                        className="md-btn md-btn-sm md-btn-outlined"
                                        style={{ flex: !isVerified && photoUrl ? 'unset' : 1, fontSize: '11px', padding: '4px 8px' }}
                                        onClick={() => onSelectCandidate && onSelectCandidate(sid)}
                                        title="View full evidence timeline & screenshots"
                                    >
                                        <Eye size={12} />
                                        <span>Review</span>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

