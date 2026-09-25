import React, { useState, useEffect } from 'react';
import useSocket from '../hooks/useSocket';
import ExamManager from '../components/ExamManager';
import ExamSummary from '../components/ExamSummary';
import StudentList from '../components/StudentList';
import AlertFeed from '../components/AlertFeed';
import PriorityQueue from '../components/PriorityQueue';
import EvidenceViewer from '../components/EvidenceViewer';
import CandidateGrid from '../components/CandidateGrid';
import AdminDashboard from '../components/AdminDashboard/AdminDashboard';
import LiveExamChat from '../components/LiveExamChat';
import { Shield, Layers, Radio, ArrowLeft, CheckCircle, AlertCircle, X, Volume2, VolumeX, Grid, User, LogOut, Lock, Sparkles, FolderKanban, MessageSquare, Menu, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthModal from '../components/AuthModal';
import './Dashboard.css';

const API_BASE = 'http://localhost:5000';

let globalAudioCtx = null;

function getAudioContext() {
    if (!globalAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            globalAudioCtx = new AudioCtx();
        }
    }
    return globalAudioCtx;
}

function playAlertChime() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        
        // Auto-resume if browser autoplay policy suspended the context
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }

        const now = ctx.currentTime;
        
        // Primary warning tone (880Hz -> 1320Hz)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
        gain1.gain.setValueAtTime(0.4, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.25);

        // Secondary alert ping (1320Hz -> 1760Hz)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1320, now + 0.13);
        osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.28);
        gain2.gain.setValueAtTime(0.45, now + 0.13);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.13);
        osc2.stop(now + 0.45);
    } catch (e) {
        console.warn('Audio chime play error:', e);
    }
}

export default function Dashboard() {
    const { connected, violations, riskScores, socket } = useSocket();
    const { teacher, showAuthModal, setShowAuthModal, logout, demoLogin, authFetch } = useAuth();
    const [selectedSessionId, setSelectedSessionId] = useState(null);
    const [activeTab, setActiveTab] = useState('exams'); // 'exams' or 'monitoring'
    const [rightPanelView, setRightPanelView] = useState('priority'); // 'priority', 'feed', 'grid', 'evidence', 'chat'
    const [selectedExamFilter, setSelectedExamFilter] = useState(null);
    const [selectedSummaryExamId, setSelectedSummaryExamId] = useState(null);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [chatSessionId, setChatSessionId] = useState(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const lastSeenViolationIdRef = React.useRef(null);
    const isInitialMountRef = React.useRef(true);

    // End exam confirmation state from live monitoring view
    const [showEndExamConfirm, setShowEndExamConfirm] = useState(false);

    // Pre-unlock audio context on first user interaction
    useEffect(() => {
        const unlockAudio = () => {
            const ctx = getAudioContext();
            if (ctx && ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }
        };
        window.addEventListener('click', unlockAudio, { once: true });
        window.addEventListener('keydown', unlockAudio, { once: true });
        return () => {
            window.removeEventListener('click', unlockAudio);
            window.removeEventListener('keydown', unlockAudio);
        };
    }, []);

    // Play sound chime on newly arriving violation
    useEffect(() => {
        if (!violations || violations.length === 0) return;

        const latest = violations[0];
        const latestId = String(latest._id || latest.id || latest.timestamp);

        // On first mount, establish baseline without blaring sound for old historical logs
        if (isInitialMountRef.current) {
            isInitialMountRef.current = false;
            lastSeenViolationIdRef.current = latestId;
            return;
        }

        // If a new live violation arrived
        if (latestId !== lastSeenViolationIdRef.current) {
            lastSeenViolationIdRef.current = latestId;
            if (soundEnabled && latest.severity >= 2) {
                playAlertChime();
            }
        }
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
        setMobileMenuOpen(false);
    };

    const handleSelectExamSummary = (examId) => {
        setSelectedSummaryExamId(examId);
        setActiveTab('exams');
        setMobileMenuOpen(false);
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
                <div className="header-brand-container">
                    <div className="header-brand" onClick={() => { setActiveTab('exams'); setSelectedSummaryExamId(null); }} style={{ cursor: 'pointer' }}>
                        <img src="/logo.svg" alt="IntegrityFlow Logo" className="brand-logo-img" />
                        <div className="brand-text-container">
                            <h1 className="brand-title">IntegrityFlow</h1>
                            <span className="brand-subtitle-tag">Examiner Dashboard</span>
                        </div>
                    </div>
                </div>

                {/* Desktop Navigation & Actions */}
                <div className="header-controls desktop-only-controls">
                    <nav className="nav-tabs" aria-label="Main Navigation">
                        <button 
                            className={`nav-tab-btn ${activeTab === 'exams' ? 'active' : ''}`}
                            onClick={() => {
                                setSelectedSummaryExamId(null);
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
                        {teacher?.role === 'admin' && (
                            <button 
                                className={`nav-tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('admin');
                                }}
                            >
                                <FolderKanban size={16} />
                                <span>Admin & Storage</span>
                            </button>
                        )}
                    </nav>

                    <div className="header-actions-group">
                        <button 
                            className={`header-sound-btn ${soundEnabled ? 'active' : ''}`}
                            onClick={() => setSoundEnabled(!soundEnabled)}
                            title={soundEnabled ? "Alert Sound Enabled (Click to Mute)" : "Alert Sound Muted (Click to Unmute)"}
                        >
                            {soundEnabled ? <Volume2 size={16} className="sound-icon-on" /> : <VolumeX size={16} className="sound-icon-off" />}
                            <span className="sound-btn-text">{soundEnabled ? 'Sound ON' : 'Muted'}</span>
                        </button>

                        <div className="connection-status">
                            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
                            <span className="connection-text">{connected ? 'Online' : 'Connecting...'}</span>
                        </div>

                        {/* Teacher Auth Controls */}
                        {teacher ? (
                            <div className="teacher-profile-badge">
                                <div className={`teacher-avatar ${teacher.role === 'admin' ? 'admin' : 'examiner'}`}>
                                    {teacher.name ? teacher.name.charAt(0).toUpperCase() : 'T'}
                                </div>
                                <div className="teacher-info">
                                    <span className="teacher-name">{teacher.name}</span>
                                    <span className={`teacher-role ${teacher.role === 'admin' ? 'admin' : 'examiner'}`}>
                                        {teacher.role === 'admin' ? '🛡️ Administrator' : 'Examiner'}
                                    </span>
                                </div>
                                <button
                                    onClick={logout}
                                    title="Sign Out"
                                    className="teacher-logout-btn"
                                >
                                    <LogOut size={14} />
                                </button>
                            </div>
                        ) : (
                            <div className="auth-header-group">
                                {(import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true' || (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN !== 'false')) && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => demoLogin('admin')}
                                            title="Sign in as Administrator"
                                            className="demo-auth-btn admin-demo"
                                        >
                                            <Shield size={14} />
                                            <span>Demo Admin</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => demoLogin('teacher')}
                                            title="Sign in as Regular Teacher"
                                            className="demo-auth-btn teacher-demo"
                                        >
                                            <Sparkles size={14} />
                                            <span>Demo Teacher</span>
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setShowAuthModal(true)}
                                    className="signin-header-btn"
                                >
                                    <Lock size={14} />
                                    <span>Sign In</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Mobile Quick Header Actions & Hamburger Toggle */}
                <div className="mobile-header-actions">
                    <button 
                        className={`header-sound-btn-compact ${soundEnabled ? 'active' : ''}`}
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        title={soundEnabled ? "Alert Sound ON" : "Alert Sound Muted"}
                    >
                        {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>

                    <div className="connection-status-compact" title={connected ? 'System Online' : 'Connecting...'}>
                        <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
                    </div>

                    <button 
                        className="mobile-menu-toggle-btn"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                    >
                        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>
            </header>

            {/* Responsive Mobile Navigation Drawer */}
            {mobileMenuOpen && (
                <div className="mobile-nav-overlay" onClick={() => setMobileMenuOpen(false)}>
                    <div className="mobile-nav-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="mobile-nav-section">
                            <div className="mobile-nav-label">Navigation</div>
                            <button 
                                className={`mobile-nav-item ${activeTab === 'exams' ? 'active' : ''}`}
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('exams');
                                    setMobileMenuOpen(false);
                                }}
                            >
                                <Layers size={18} />
                                <span>Exams & Analytics</span>
                            </button>
                            <button 
                                className={`mobile-nav-item ${activeTab === 'monitoring' ? 'active' : ''}`}
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('monitoring');
                                    setMobileMenuOpen(false);
                                }}
                            >
                                <Radio size={18} />
                                <span>Live Monitoring</span>
                            </button>
                            {teacher?.role === 'admin' && (
                                <button 
                                    className={`mobile-nav-item ${activeTab === 'admin' ? 'active' : ''}`}
                                    onClick={() => {
                                        setSelectedSummaryExamId(null);
                                        setActiveTab('admin');
                                        setMobileMenuOpen(false);
                                    }}
                                >
                                    <FolderKanban size={18} />
                                    <span>Admin & Storage Console</span>
                                </button>
                            )}
                        </div>

                        <div className="mobile-nav-divider"></div>

                        {/* Mobile Auth / Profile Section */}
                        <div className="mobile-nav-section">
                            <div className="mobile-nav-label">Account & Access</div>
                            {teacher ? (
                                <div className="mobile-user-card">
                                    <div className="mobile-user-top">
                                        <div className={`teacher-avatar ${teacher.role === 'admin' ? 'admin' : 'examiner'}`}>
                                            {teacher.name ? teacher.name.charAt(0).toUpperCase() : 'T'}
                                        </div>
                                        <div className="teacher-info">
                                            <span className="teacher-name">{teacher.name}</span>
                                            <span className="teacher-role">{teacher.role === 'admin' ? '🛡️ Administrator' : 'Examiner'}</span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => {
                                            logout();
                                            setMobileMenuOpen(false);
                                        }}
                                        className="mobile-logout-btn"
                                    >
                                        <LogOut size={16} />
                                        <span>Sign Out</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="mobile-auth-actions">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowAuthModal(true);
                                            setMobileMenuOpen(false);
                                        }}
                                        className="signin-header-btn mobile-full-btn"
                                    >
                                        <Lock size={16} />
                                        <span>Sign In / Create Account</span>
                                    </button>
                                    {(import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true' || (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN !== 'false')) && (
                                        <div className="mobile-demo-row">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    demoLogin('admin');
                                                    setMobileMenuOpen(false);
                                                }}
                                                className="demo-auth-btn admin-demo mobile-half-btn"
                                            >
                                                <Shield size={14} />
                                                <span>Demo Admin</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    demoLogin('teacher');
                                                    setMobileMenuOpen(false);
                                                }}
                                                className="demo-auth-btn teacher-demo mobile-half-btn"
                                            >
                                                <Sparkles size={14} />
                                                <span>Demo Teacher</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Areas */}
            {activeTab === 'admin' ? (
                <main className="dashboard-main-single">
                    <AdminDashboard 
                        onNavigateExams={() => setActiveTab('exams')}
                        onNavigateMonitoring={() => setActiveTab('monitoring')}
                    />
                </main>
            ) : activeTab === 'exams' ? (
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
                    
                    {/* Right Column: Priority Queue / Alert Feed / Evidence Timeline / Candidate Grid / Chat */}
                    <div className="dashboard-right">
                        <div className="right-panel-header">
                            <h2>
                                {rightPanelView === 'priority'
                                    ? 'Cross-Student Priority Queue'
                                    : rightPanelView === 'feed' 
                                    ? 'Real-Time Alert Feed' 
                                    : rightPanelView === 'grid' 
                                    ? 'Candidate Webcam Grid' 
                                    : rightPanelView === 'chat'
                                    ? `Exam Chat & Inquiries (${selectedExamFilter || 'Active Exam'})`
                                    : `Evidence Review: ${selectedSessionId || ''}`}
                            </h2>
                            <div className="sub-tabs">
                                <button 
                                    className={`sub-tab-btn ${rightPanelView === 'priority' ? 'active' : ''}`}
                                    onClick={() => setRightPanelView('priority')}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                >
                                    <Zap size={13} style={{ color: rightPanelView === 'priority' ? '#d93025' : '#5f6368' }} />
                                    <span>Priority Queue</span>
                                </button>
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
                                <button 
                                    className={`sub-tab-btn ${rightPanelView === 'chat' ? 'active' : ''}`}
                                    onClick={() => setRightPanelView('chat')}
                                >
                                    Exam Chat
                                </button>
                            </div>
                        </div>

                        {rightPanelView === 'priority' ? (
                            <PriorityQueue 
                                socket={socket}
                                examFilter={selectedExamFilter}
                                onSelectExamFilter={setSelectedExamFilter}
                                onSelectStudentForReview={(sid) => {
                                    setSelectedSessionId(sid);
                                    setRightPanelView('evidence');
                                }}
                            />
                        ) : rightPanelView === 'feed' ? (
                            <AlertFeed 
                                violations={violations} 
                                onSelectViolation={(v) => {
                                    if (v?.sessionId) {
                                        setSelectedSessionId(v.sessionId);
                                        setRightPanelView('evidence');
                                    }
                                }}
                            />
                        ) : rightPanelView === 'grid' ? (
                            <CandidateGrid 
                                riskScores={riskScores} 
                                violations={violations} 
                                examFilter={selectedExamFilter}
                                onSelectCandidate={(sid) => {
                                    setSelectedSessionId(sid);
                                    setRightPanelView('evidence');
                                }} 
                                onOpenChat={(sid) => {
                                    setChatSessionId(sid);
                                    setRightPanelView('chat');
                                }}
                            />
                        ) : rightPanelView === 'chat' ? (
                            <LiveExamChat 
                                isInline={true}
                                examId={selectedExamFilter}
                                initialSessionId={chatSessionId}
                                activeSessions={Object.values(riskScores || {})}
                                socket={socket}
                            />
                        ) : (
                            <EvidenceViewer 
                                sessionId={selectedSessionId} 
                                liveViolations={violations}
                            />
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
