import React, { useState, useEffect } from 'react';
import useSocket from '../hooks/useSocket';
import ExamManager from '../components/ExamManager';
import ExamSummary from '../components/ExamSummary';
import StudentList from '../components/StudentList';
import AlertFeed from '../components/AlertFeed';
import EvidenceViewer from '../components/EvidenceViewer';
import CandidateGrid from '../components/CandidateGrid';
import { Shield, Layers, Radio, ArrowLeft, CheckCircle, AlertCircle, X, Volume2, VolumeX, Grid, User, LogOut, Lock, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthModal from '../components/AuthModal';
import './Dashboard.css';

const API_BASE = 'http://localhost:5000';

function playAlertChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        
        // Pitch 1
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, ctx.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15);
        gain1.gain.setValueAtTime(0.3, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start();
        osc1.stop(ctx.currentTime + 0.3);

        // Pitch 2
        setTimeout(() => {
            if (ctx.state === 'closed') return;
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1100, ctx.currentTime);
            osc2.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.15);
            gain2.gain.setValueAtTime(0.35, ctx.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start();
            osc2.stop(ctx.currentTime + 0.3);
        }, 150);
    } catch (e) {
        console.warn('Audio chime play error:', e);
    }
}

export default function Dashboard() {
    const { connected, violations, riskScores } = useSocket();
    const { teacher, showAuthModal, setShowAuthModal, logout, demoLogin, authFetch } = useAuth();
    const [selectedSessionId, setSelectedSessionId] = useState(null);
    const [activeTab, setActiveTab] = useState('exams'); // 'exams' or 'monitoring'
    const [rightPanelView, setRightPanelView] = useState('feed'); // 'feed' or 'evidence'
    const [selectedExamFilter, setSelectedExamFilter] = useState(null);
    const [selectedSummaryExamId, setSelectedSummaryExamId] = useState(null);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [prevViolationCount, setPrevViolationCount] = useState(0);

    // End exam confirmation state from live monitoring view
    const [showEndExamConfirm, setShowEndExamConfirm] = useState(false);

    // Play sound chime on new high-severity alert
    useEffect(() => {
        if (violations && violations.length > prevViolationCount) {
            const latest = violations[0];
            if (soundEnabled && latest && latest.severity >= 3) {
                playAlertChime();
            }
        }
        setPrevViolationCount(violations ? violations.length : 0);
    }, [violations, soundEnabled]);

    // Auto-switch to evidence review when a student is clicked in the list
    useEffect(() => {
        if (selectedSessionId) {
            setRightPanelView('evidence');
        }
    }, [selectedSessionId]);

    const handleSelectExamForMonitoring = (exam) => {
        setSelectedExamFilter(exam.examCode);
        setSelectedSummaryExamId(null);
        setActiveTab('monitoring');
    };

    const handleSelectExamSummary = (examId) => {
        setSelectedSummaryExamId(examId);
        setActiveTab('exams');
    };

    const handleEndCurrentExam = async () => {
        if (!selectedExamFilter) return;
        try {
            // Find exam by code
            const res = await authFetch(`${API_BASE}/exams/code/${selectedExamFilter}`);
            if (res.ok) {
                const exam = await res.json();
                await authFetch(`${API_BASE}/exams/${exam._id}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'completed' })
                });
            }
        } catch (err) {
            console.error('Failed to end exam:', err);
        } finally {
            setShowEndExamConfirm(false);
            setSelectedExamFilter(null);
            setActiveTab('exams');
        }
    };

    return (
        <div className="dashboard-container">
            {/* Header Bar */}
            <header className="dashboard-header">
                <div className="header-brand">
                    <img src="/logo.svg" alt="IntegrityFlow Logo" className="brand-logo-img" />
                    <div className="brand-text-container">
                        <h1 className="brand-title">IntegrityFlow</h1>
                        <span className="brand-subtitle-tag">Examiner Dashboard</span>
                    </div>
                </div>

                <div className="header-controls">
                    <div className="nav-tabs">
                        <button 
                            className={`nav-tab-btn ${activeTab === 'exams' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('exams');
                            }}
                        >
                            <Layers size={16} />
                            <span>Exams & Analytics</span>
                        </button>
                        <button 
                            className={`nav-tab-btn ${activeTab === 'monitoring' ? 'active' : ''}`}
                            onClick={() => {
                                setSelectedSummaryExamId(null);
                                setActiveTab('monitoring');
                            }}
                        >
                            <Radio size={16} />
                            <span>Live Monitoring</span>
                        </button>
                    </div>

                    <button 
                        className={`nav-tab-btn ${soundEnabled ? 'active' : ''}`}
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        title={soundEnabled ? "Alert Sound Enabled (Click to Mute)" : "Alert Sound Muted (Click to Unmute)"}
                        style={{ padding: '6px 12px' }}
                    >
                        {soundEnabled ? <Volume2 size={16} style={{ color: '#137333' }} /> : <VolumeX size={16} style={{ color: '#70757a' }} />}
                        <span>{soundEnabled ? 'Sound ON' : 'Muted'}</span>
                    </button>

                    <div className="connection-status">
                        <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
                        <span>{connected ? 'System Online' : 'Connecting...'}</span>
                    </div>

                    {/* Teacher Auth Controls */}
                    {teacher ? (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            background: 'var(--surface-color)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '4px 10px'
                        }}>
                            <div style={{
                                width: 26,
                                height: 26,
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, var(--brand-primary), #7c3aed)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontSize: 12,
                                fontWeight: 700
                            }}>
                                {teacher.name ? teacher.name.charAt(0).toUpperCase() : 'T'}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                                    {teacher.name}
                                </span>
                                <span style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                                    {teacher.role || 'Teacher'}
                                </span>
                            </div>
                            <button
                                onClick={logout}
                                title="Sign Out"
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    marginLeft: 4
                                }}
                            >
                                <LogOut size={14} />
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                                type="button"
                                onClick={() => demoLogin()}
                                title="1-Click Quick Demo Sign-in"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 14px',
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #dadce0',
                                    borderRadius: '4px',
                                    color: '#1a73e8',
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    transition: 'background-color 0.15s ease'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(26, 115, 232, 0.04)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
                            >
                                <Sparkles size={14} color="#1a73e8" />
                                <span>Demo Sign-in</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowAuthModal(true)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 16px',
                                    backgroundColor: '#1a73e8',
                                    border: 'none',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    boxShadow: '0 1px 2px rgba(60,64,67,0.3)',
                                    transition: 'background-color 0.15s ease'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1557d0'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1a73e8'}
                            >
                                <Lock size={14} color="#ffffff" />
                                <span>Sign In</span>
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* Main Content Areas */}
            {activeTab === 'exams' ? (
                <main className="dashboard-main-single">
                    {selectedSummaryExamId ? (
                        <ExamSummary 
                            examId={selectedSummaryExamId} 
                            onBack={() => setSelectedSummaryExamId(null)} 
                        />
                    ) : (
                        <ExamManager 
                            onSelectExamForMonitoring={handleSelectExamForMonitoring}
                            onSelectExamSummary={handleSelectExamSummary}
                        />
                    )}
                </main>
            ) : (
                <main className="dashboard-main-layout">
                    {/* Left Column: Student List */}
                    <div className="dashboard-left">
                        {selectedExamFilter && (
                            <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                                <button 
                                    className="sub-tab-btn" 
                                    onClick={() => setSelectedExamFilter(null)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                >
                                    <ArrowLeft size={14} />
                                    <span>Clear Filter ({selectedExamFilter})</span>
                                </button>
                                <button 
                                    className="md-btn md-btn-outlined md-btn-sm btn-end-exam"
                                    onClick={() => setShowEndExamConfirm(true)}
                                    style={{ color: 'var(--risk-high)', borderColor: 'var(--risk-high-bg)' }}
                                >
                                    <CheckCircle size={14} />
                                    <span>End Exam</span>
                                </button>
                            </div>
                        )}
                        <StudentList 
                            riskScores={riskScores} 
                            violations={violations}
                            onSelectStudent={setSelectedSessionId} 
                            selectedSessionId={selectedSessionId}
                            examFilter={selectedExamFilter}
                        />
                    </div>
                    
                    {/* Right Column: Alert Feed / Evidence Timeline / Candidate Grid */}
                    <div className="dashboard-right">
                        <div className="right-panel-header">
                            <h2>
                                {rightPanelView === 'feed' 
                                    ? 'Real-Time Alert Feed' 
                                    : rightPanelView === 'grid' 
                                    ? 'Candidate Webcam Grid' 
                                    : `Evidence Review: ${selectedSessionId || ''}`}
                            </h2>
                            <div className="sub-tabs">
                                <button 
                                    className={`sub-tab-btn ${rightPanelView === 'feed' ? 'active' : ''}`}
                                    onClick={() => setRightPanelView('feed')}
                                >
                                    Live Feed
                                </button>
                                <button 
                                    className={`sub-tab-btn ${rightPanelView === 'grid' ? 'active' : ''}`}
                                    onClick={() => setRightPanelView('grid')}
                                >
                                    Webcam Grid
                                </button>
                                <button 
                                    className={`sub-tab-btn ${rightPanelView === 'evidence' ? 'active' : ''}`}
                                    onClick={() => setRightPanelView('evidence')}
                                    disabled={!selectedSessionId}
                                >
                                    Evidence Review
                                </button>
                            </div>
                        </div>

                        {rightPanelView === 'feed' ? (
                            <AlertFeed violations={violations} />
                        ) : rightPanelView === 'grid' ? (
                            <CandidateGrid 
                                riskScores={riskScores} 
                                violations={violations} 
                                examFilter={selectedExamFilter}
                                onSelectCandidate={(sid) => {
                                    setSelectedSessionId(sid);
                                    setRightPanelView('evidence');
                                }} 
                            />
                        ) : (
                            <EvidenceViewer sessionId={selectedSessionId} />
                        )}
                    </div>
                </main>
            )}

            {/* End Exam Confirmation Modal from Live View */}
            {showEndExamConfirm && (
                <div className="md-modal-overlay">
                    <div className="md-modal-card" style={{ maxWidth: '440px' }}>
                        <div className="md-modal-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
                            <h3 style={{ color: 'var(--risk-high)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <AlertCircle size={20} /> End Current Exam ({selectedExamFilter})?
                            </h3>
                            <button className="md-icon-btn" onClick={() => setShowEndExamConfirm(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div style={{ padding: '16px 0', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
                            End the exam session for code <strong>"{selectedExamFilter}"</strong>?
                            <p style={{ marginTop: '8px', color: 'var(--text-primary)', fontWeight: '500' }}>
                                Students will no longer be able to join or submit. Active candidate sessions will be moved to completed archives.
                            </p>
                        </div>
                        <div className="md-modal-actions">
                            <button className="md-btn md-btn-text" onClick={() => setShowEndExamConfirm(false)}>
                                Cancel
                            </button>
                            <button className="md-btn md-btn-danger" onClick={handleEndCurrentExam}>
                                Confirm End Exam
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Examiner Auth Modal */}
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </div>
    );
}
