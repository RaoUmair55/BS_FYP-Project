import React, { useState, useEffect } from 'react';
import useSocket from '../hooks/useSocket';
import { selectLiveAlerts } from '../utils/liveAlerts';
import ExamManager from '../components/ExamManager';
import ExamSummary from '../components/ExamSummary';
import StudentList from '../components/StudentList';
import AlertFeed from '../components/AlertFeed';
import PriorityQueue from '../components/PriorityQueue';
import EvidenceViewer from '../components/EvidenceViewer';
import CandidateGrid from '../components/CandidateGrid';
import AdminDashboard from '../components/AdminDashboard/AdminDashboard';
import LiveExamChat from '../components/LiveExamChat';
import ExamTimeExpiryAlert from '../components/ExamTimeExpiryAlert';
import ActiveExamOverview from '../components/ActiveExamOverview';
import api, { getActiveSessions } from '../services/api';
import { 
    Shield, Layers, Radio, CheckCircle, AlertCircle, X, Volume2, 
    VolumeX, Grid, User, LogOut, Lock, Sparkles, FolderKanban, 
    MessageSquare, Menu, Zap, Sun, Moon, Search, Bell, Users,
    PanelLeftClose, PanelLeftOpen, Minimize2, Maximize2,
    LayoutDashboard, ShieldAlert, Wifi, FileBarChart2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthModal from '../components/AuthModal';
import ModalPortal from '../components/ModalPortal';
import notify from '../utils/notify';
import './Dashboard.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

let globalAudioCtx = null;
let welcomedTeacherKey = null;

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

export default function Dashboard({ theme = 'light', onToggleTheme = () => {} }) {
    const { connected, violations: receivedViolations, riskScores, socket, secondaryCameraStatuses, secondaryCameraMeta } = useSocket();
    const { teacher, showAuthModal, setShowAuthModal, logout, demoLogin, authFetch } = useAuth();
    const [selectedSessionId, setSelectedSessionId] = useState(null);
    const [activeTab, setActiveTab] = useState('monitoring');
    const [rightPanelView, setRightPanelView] = useState('priority'); // 'priority', 'feed', 'grid', 'evidence', 'chat'
    const [selectedExamFilter, setSelectedExamFilter] = useState(null);
    const [selectedSummaryExamId, setSelectedSummaryExamId] = useState(null);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [chatSessionId, setChatSessionId] = useState(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('integrityflow-sidebar-collapsed') === 'true');
    const [focusMode, setFocusMode] = useState(() => localStorage.getItem('integrityflow-focus-mode') === 'true');
    const [unreadChatCount, setUnreadChatCount] = useState(0);
    const [searchFocused, setSearchFocused] = useState(false);
    const searchBoxRef = React.useRef(null);
    const rightPanelViewRef = React.useRef(rightPanelView);
    rightPanelViewRef.current = rightPanelView;

    const toggleSidebarCollapsed = () => {
        setSidebarCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('integrityflow-sidebar-collapsed', String(next));
            return next;
        });
    };
    const toggleFocusMode = () => {
        setFocusMode(prev => {
            const next = !prev;
            localStorage.setItem('integrityflow-focus-mode', String(next));
            return next;
        });
    };
    const [searchQuery, setSearchQuery] = useState('');
    const [activeExams, setActiveExams] = useState([]);
    const [activeSessions, setActiveSessions] = useState([]);
    const violations = React.useMemo(() => selectLiveAlerts(receivedViolations, activeExams), [receivedViolations, activeExams]);
    const [activeExamsLoaded, setActiveExamsLoaded] = useState(false);
    const [highAlertCount, setHighAlertCount] = useState(0);

    const lastSeenViolationIdRef = React.useRef(null);
    const isInitialMountRef = React.useRef(true);

    // End exam confirmation state from live monitoring view
    const [showEndExamConfirm, setShowEndExamConfirm] = useState(false);
    const [endExamTargetCode, setEndExamTargetCode] = useState(null);
    const [endingExam, setEndingExam] = useState(false);
    const [endExamError, setEndExamError] = useState('');

    // Teacher-focused live KPI derivations
    const liveSessionsList = React.useMemo(
        () => (activeSessions || []).filter(s => s.status === 'active'),
        [activeSessions]
    );
    const studentsRequiringReviewCount = React.useMemo(() => {
        const flaggedIds = new Set();
        (violations || []).forEach(v => {
            if (!v.reviewed && v.decision !== 'dismissed' && v.sessionId) {
                flaggedIds.add(String(v.sessionId));
            }
        });
        liveSessionsList.forEach(s => {
            const sid = String(s.sessionId || s._id);
            const score = riskScores[sid] !== undefined ? riskScores[sid] : (s.riskScore || 0);
            if (score >= 50) flaggedIds.add(sid);
        });
        return flaggedIds.size;
    }, [violations, liveSessionsList, riskScores]);

    const stableConnectionsStats = React.useMemo(() => {
        const total = liveSessionsList.length;
        if (total === 0) return { stable: 0, total: 0, pct: 100 };
        const stable = liveSessionsList.filter(s => {
            const sid = String(s.sessionId || s._id);
            const sideStatus = secondaryCameraStatuses[sid] || s.secondaryCamera?.status;
            return sideStatus !== 'lost';
        }).length;
        return { stable, total, pct: Math.round((stable / total) * 100) };
    }, [liveSessionsList, secondaryCameraStatuses]);

    const formattedTodayDate = React.useMemo(() => {
        try {
            return new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch {
            return new Date().toDateString();
        }
    }, []);

    // Display a clean Sileo welcome notification when the dashboard first opens
    useEffect(() => {
        if (!teacher) return;
        const key = String(teacher.id || teacher._id || teacher.email || 'examiner');
        if (welcomedTeacherKey === key) return;

        const firstName = (teacher.name || '').trim().split(/\s+/)[0] || 'Examiner';
        const timer = setTimeout(() => {
            if (welcomedTeacherKey === key) return;
            welcomedTeacherKey = key;
            notify.success(
                `Welcome back, ${firstName}!`,
                'Your live proctoring desk is connected and ready to monitor active exams.',
                { duration: 4500 }
            );
        }, 350);

        return () => clearTimeout(timer);
    }, [teacher]);

    useEffect(() => {
        let mounted = true;
        const refreshLiveOverview = async () => {
            try {
                const [examsResult, alertsResult, sessionsResult] = await Promise.allSettled([
                    api.get('/exams?status=active'),
                    api.get('/violations/priority-queue'),
                    getActiveSessions()
                ]);
                if (!mounted) return;
                if (examsResult.status === 'fulfilled') {
                    setActiveExams(Array.isArray(examsResult.value.data) ? examsResult.value.data : []);
                    setActiveExamsLoaded(true);
                }
                if (alertsResult.status === 'fulfilled') setHighAlertCount(Array.isArray(alertsResult.value.data)
                    ? alertsResult.value.data.filter(v => Number(v.severity) >= 4 && !v.reviewed && v.decision !== 'dismissed').length
                    : 0);
                if (sessionsResult.status === 'fulfilled') {
                    setActiveSessions(Array.isArray(sessionsResult.value.data) ? sessionsResult.value.data : []);
                }
            } catch (err) {
                if (mounted) console.warn('Could not refresh live monitoring summary:', err);
            }
        };
        refreshLiveOverview();
        const interval = setInterval(refreshLiveOverview, 15000);
        return () => { mounted = false; clearInterval(interval); };
    }, []);

    useEffect(() => {
        if (!socket) return;
        const refresh = () => {
            api.get('/violations/priority-queue')
                .then(res => setHighAlertCount(Array.isArray(res.data)
                    ? res.data.filter(v => Number(v.severity) >= 4 && !v.reviewed && v.decision !== 'dismissed').length
                    : 0))
                .catch(() => {});
            
            // Refresh active exams list if an exam completed
            api.get('/exams?status=active')
                .then(res => {
                    setActiveExams(Array.isArray(res.data) ? res.data : []);
                })
                .catch(() => {});

            getActiveSessions()
                .then(res => {
                    setActiveSessions(Array.isArray(res.data) ? res.data : []);
                })
                .catch(() => {});
        };

        const handleIncomingChat = (msg) => {
            if (!msg || msg.sender !== 'student') return;
            if (rightPanelViewRef.current !== 'chat') {
                setUnreadChatCount(prev => prev + 1);
            }
            const preview = String(msg.text || '').slice(0, 80);
            notify.action(
                `Message from ${msg.senderName || 'Candidate'}`,
                preview,
                {
                    title: 'Reply',
                    onClick: () => {
                        if (msg.examId && !selectedExamFilter) {
                            setSelectedExamFilter(msg.examId);
                        }
                        if (msg.sessionId) setChatSessionId(msg.sessionId);
                        setActiveTab('monitoring');
                        setRightPanelView('chat');
                        setUnreadChatCount(0);
                    }
                }
            );
        };

        socket.on('violation', refresh);
        socket.on('violationReviewed', refresh);
        socket.on('examStatusChanged', refresh);
        socket.on('chatMessage', handleIncomingChat);
        return () => {
            socket.off('violation', refresh);
            socket.off('violationReviewed', refresh);
            socket.off('examStatusChanged', refresh);
            socket.off('chatMessage', handleIncomingChat);
        };
    }, [socket, selectedExamFilter]);

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

    // Keyboard shortcuts: Ctrl/Cmd+K (search), Ctrl/Cmd+B (sidebar), Esc (close overlays)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setSearchFocused(true);
                document.getElementById('workspace-global-search')?.focus();
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                toggleSidebarCollapsed();
            } else if (e.key === 'Escape') {
                if (searchFocused) {
                    setSearchFocused(false);
                    document.getElementById('workspace-global-search')?.blur();
                } else if (showEndExamConfirm && !endingExam) {
                    setShowEndExamConfirm(false);
                } else if (mobileMenuOpen) {
                    setMobileMenuOpen(false);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [searchFocused, showEndExamConfirm, endingExam, mobileMenuOpen]);

    // Close global search dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
                setSearchFocused(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Clear unread chat badge whenever Examiner opens the Chat tab
    useEffect(() => {
        if (rightPanelView === 'chat') {
            setUnreadChatCount(0);
        }
    }, [rightPanelView]);

    // Instant global command search matches (candidates, active exams, recent violations)
    const globalSearchResults = React.useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return { candidates: [], exams: [], alerts: [] };

        const candidates = (activeSessions || []).filter(s =>
            (s.studentName || '').toLowerCase().includes(q) ||
            (s.rollNumber || '').toLowerCase().includes(q) ||
            (s.studentId || '').toLowerCase().includes(q) ||
            (s.examId || '').toLowerCase().includes(q)
        ).slice(0, 5);

        const exams = (activeExams || []).filter(e =>
            (e.title || '').toLowerCase().includes(q) ||
            (e.examCode || '').toLowerCase().includes(q)
        ).slice(0, 4);

        const alerts = (violations || []).filter(v =>
            String(v.type || '').replace(/_/g, ' ').toLowerCase().includes(q) ||
            String(v.sessionId || '').toLowerCase().includes(q)
        ).slice(0, 4);

        return { candidates, exams, alerts };
    }, [searchQuery, activeSessions, activeExams, violations]);

    const hasSearchMatches = globalSearchResults.candidates.length > 0 || globalSearchResults.exams.length > 0 || globalSearchResults.alerts.length > 0;

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
            if (Number(latest.severity) >= 4 && !latest.reviewed) {
                const label = String(latest.type || 'violation').replace(/_/g, ' ');
                notify.action(
                    `High-Severity Alert (Sev ${latest.severity})`,
                    `${label.charAt(0).toUpperCase() + label.slice(1)} detected.`,
                    {
                        title: 'Review',
                        onClick: () => {
                            if (latest.sessionId) {
                                setSelectedSessionId(latest.sessionId);
                                setActiveTab('monitoring');
                                setRightPanelView('evidence');
                            }
                        }
                    }
                );
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
        setSelectedSessionId(null);
        setSelectedSummaryExamId(null);
        setActiveTab('monitoring');
        setMobileMenuOpen(false);
    };

    const handleExamFilterChange = (examId) => {
        setSelectedExamFilter(examId);
        setSelectedSessionId(null);
    };

    const handleSelectExamSummary = (examId) => {
        setSelectedSummaryExamId(examId);
        setActiveTab('history');
        setMobileMenuOpen(false);
    };

    const handleEndCurrentExam = async () => {
        const identifier = endExamTargetCode || selectedExamFilter;
        if (!identifier || endingExam) return;
        try {
            setEndingExam(true);
            setEndExamError('');
            // Use the authenticated exam roster's database ID, not the candidate code lookup response.
            const exam = activeExams.find(item => [item.examCode, item.examId, item._id].some(value =>
                String(value || '').toUpperCase() === String(identifier).toUpperCase()));
            if (!exam?._id) throw new Error('Selected active exam could not be found. Refresh and retry.');
            await api.patch(`/exams/${encodeURIComponent(exam._id)}/status`, { status: 'completed' });
            setActiveExams(previous => previous.filter(exam =>
                ![exam.examCode, exam.examId, exam._id].some(value => String(value || '').toUpperCase() === String(identifier).toUpperCase())));
            if (selectedExamFilter && String(selectedExamFilter).toUpperCase() === String(identifier).toUpperCase()) {
                setSelectedExamFilter(null);
            }
            setEndExamTargetCode(null);
            setSelectedSessionId(null);
            setShowEndExamConfirm(false);
            setActiveTab('history');
            notify.success('Exam Ended', `${identifier} has been moved to archived records.`);
        } catch (err) {
            console.error('Failed to end exam:', err);
            const msg = err.response?.data?.error || err.message || 'Could not end the exam. Please retry.';
            setEndExamError(msg);
            notify.error('Could Not End Exam', msg);
        } finally {
            setEndingExam(false);
        }
    };

    const requestEndExam = (code) => {
        setEndExamTargetCode(code);
        setEndExamError('');
        setShowEndExamConfirm(true);
    };

    const refreshLiveOverviewNow = () => {
        Promise.allSettled([
            api.get('/exams?status=active'),
            api.get('/violations/priority-queue'),
            getActiveSessions()
        ]).then(([examsResult, alertsResult, sessionsResult]) => {
            if (examsResult.status === 'fulfilled') {
                setActiveExams(Array.isArray(examsResult.value.data) ? examsResult.value.data : []);
            }
            if (alertsResult.status === 'fulfilled') {
                setHighAlertCount(Array.isArray(alertsResult.value.data)
                    ? alertsResult.value.data.filter(v => Number(v.severity) >= 4 && !v.reviewed && v.decision !== 'dismissed').length
                    : 0);
            }
            if (sessionsResult.status === 'fulfilled') {
                setActiveSessions(Array.isArray(sessionsResult.value.data) ? sessionsResult.value.data : []);
            }
        });
    };

    return (
        <div className="dashboard-outer-shell">
            {/* 1. Left Fluent Sidebar (252px expanded, 68px icon rail collapsed, drawer on mobile) */}
            <aside className={`floating-sidebar ${mobileMenuOpen ? 'mobile-open' : ''} ${sidebarCollapsed ? 'desktop-collapsed' : ''}`}>
                {/* Brand Header */}
                <div className="sidebar-brand-row">
                    <div 
                        className="sidebar-brand" 
                        onClick={() => { setActiveTab('monitoring'); setSelectedSummaryExamId(null); setMobileMenuOpen(false); }}
                        title="IntegrityFlow Teacher Dashboard"
                    >
                        <div className="sidebar-brand-mark">
                            <img src="/logo.svg" alt="IntegrityFlow Logo" className="sidebar-brand-logo" />
                        </div>
                        <div className="sidebar-brand-text">
                            <h1 className="sidebar-brand-title">IntegrityFlow</h1>
                            <span className="sidebar-brand-subtitle">Assessment &amp; Proctoring</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="sidebar-collapse-btn"
                        onClick={toggleSidebarCollapsed}
                        title={sidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
                        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
                    </button>
                </div>

                {/* Active Exam Context Switcher (Vercel / Linear / Fluent 2 Pattern) */}
                {activeExams.length > 0 && (
                    <div className="sidebar-context-wrap">
                        <div className="sidebar-context-box" title="Filter monitoring desk by active examination">
                            <span className="status-dot connected" />
                            <select
                                className="sidebar-context-select"
                                value={selectedExamFilter || ''}
                                onChange={(e) => {
                                    handleExamFilterChange(e.target.value || null);
                                    setActiveTab('monitoring');
                                    setMobileMenuOpen(false);
                                }}
                                aria-label="Active examination context"
                            >
                                <option value="">All Active Exams ({activeExams.length})</option>
                                {activeExams.map(ex => (
                                    <option key={ex._id || ex.examCode} value={ex.examCode}>
                                        {ex.examCode} · {ex.title}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

                {/* Grouped Fluent Navigation Links (Mapped strictly to real views) */}
                <div className="sidebar-nav-scroll">
                    <div className="sidebar-nav-group">
                        <div className="sidebar-section-label">TEACHING</div>
                        <nav className="sidebar-nav-list" aria-label="Teaching Navigation">
                            <button
                                className={`sidebar-nav-pill ${activeTab === 'monitoring' && rightPanelView !== 'grid' && rightPanelView !== 'chat' && rightPanelView !== 'priority' ? 'active' : ''}`}
                                title="Dashboard & Live Desk"
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('monitoring');
                                    if (rightPanelView === 'grid' || rightPanelView === 'chat') setRightPanelView('priority');
                                    setMobileMenuOpen(false);
                                }}
                            >
                                <div className="sidebar-nav-pill-left">
                                    <span className="sidebar-nav-icon-well"><LayoutDashboard size={15} /></span>
                                    <span className="sidebar-nav-label">Dashboard</span>
                                </div>
                            </button>

                            <button
                                className={`sidebar-nav-pill ${activeTab === 'exams' ? 'active' : ''}`}
                                title="My Exams"
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('exams');
                                    setMobileMenuOpen(false);
                                }}
                            >
                                <div className="sidebar-nav-pill-left">
                                    <span className="sidebar-nav-icon-well"><Layers size={15} /></span>
                                    <span className="sidebar-nav-label">My Exams</span>
                                </div>
                                {activeExams.length > 0 && (
                                    <span className="sidebar-badge-neutral tabular-nums">
                                        {activeExams.length}
                                    </span>
                                )}
                            </button>

                            <button
                                className={`sidebar-nav-pill ${activeTab === 'history' ? 'active' : ''}`}
                                title="Evidence & Reports (Exam History & Analytics)"
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('history');
                                    setMobileMenuOpen(false);
                                }}
                            >
                                <div className="sidebar-nav-pill-left">
                                    <span className="sidebar-nav-icon-well"><FileBarChart2 size={15} /></span>
                                    <span className="sidebar-nav-label">Reports &amp; Analytics</span>
                                </div>
                            </button>
                        </nav>
                    </div>

                    <div className="sidebar-nav-group">
                        <div className="sidebar-section-label">PROCTORING</div>
                        <nav className="sidebar-nav-list" aria-label="Proctoring Navigation">
                            <button
                                className={`sidebar-nav-pill ${activeTab === 'monitoring' && rightPanelView === 'grid' ? 'active' : ''}`}
                                title="Live Monitoring Grid"
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('monitoring');
                                    setRightPanelView('grid');
                                    setMobileMenuOpen(false);
                                }}
                            >
                                <div className="sidebar-nav-pill-left">
                                    <span className="sidebar-nav-icon-well"><Grid size={15} /></span>
                                    <span className="sidebar-nav-label">Live Monitoring</span>
                                </div>
                                {liveSessionsList.length > 0 && (
                                    <span className="sidebar-badge-neutral tabular-nums">
                                        {liveSessionsList.length}
                                    </span>
                                )}
                            </button>

                            <button
                                className={`sidebar-nav-pill ${activeTab === 'monitoring' && rightPanelView === 'priority' ? 'active' : ''}`}
                                title="Incident Center (Priority Alerts)"
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('monitoring');
                                    setRightPanelView('priority');
                                    setMobileMenuOpen(false);
                                }}
                            >
                                <div className="sidebar-nav-pill-left">
                                    <span className="sidebar-nav-icon-well"><ShieldAlert size={15} /></span>
                                    <span className="sidebar-nav-label">Incident Center</span>
                                </div>
                                {highAlertCount > 0 && (
                                    <span className="nav-alert-count tabular-nums" aria-label={`${highAlertCount} high-priority alerts`}>
                                        {highAlertCount > 99 ? '99+' : highAlertCount}
                                    </span>
                                )}
                            </button>

                            <button
                                className={`sidebar-nav-pill ${activeTab === 'monitoring' && rightPanelView === 'chat' ? 'active' : ''}`}
                                title="Candidate Exam Chat"
                                onClick={() => {
                                    setSelectedSummaryExamId(null);
                                    setActiveTab('monitoring');
                                    setRightPanelView('chat');
                                    setUnreadChatCount(0);
                                    setMobileMenuOpen(false);
                                }}
                            >
                                <div className="sidebar-nav-pill-left">
                                    <span className="sidebar-nav-icon-well"><MessageSquare size={15} /></span>
                                    <span className="sidebar-nav-label">Exam Chat</span>
                                </div>
                                {unreadChatCount > 0 && (
                                    <span className="nav-alert-count tabular-nums" style={{ background: 'var(--primary)' }}>
                                        {unreadChatCount > 99 ? '99+' : unreadChatCount}
                                    </span>
                                )}
                            </button>
                        </nav>
                    </div>

                    {teacher?.role === 'admin' && (
                        <div className="sidebar-nav-group">
                            <div className="sidebar-section-label">MANAGEMENT</div>
                            <nav className="sidebar-nav-list" aria-label="System Administration">
                                <button
                                    className={`sidebar-nav-pill ${activeTab === 'admin' ? 'active' : ''}`}
                                    title="System Administration"
                                    onClick={() => {
                                        setSelectedSummaryExamId(null);
                                        setActiveTab('admin');
                                        setMobileMenuOpen(false);
                                    }}
                                >
                                    <div className="sidebar-nav-pill-left">
                                        <span className="sidebar-nav-icon-well"><FolderKanban size={15} /></span>
                                        <span className="sidebar-nav-label">System Admin</span>
                                    </div>
                                </button>
                            </nav>
                        </div>
                    )}
                </div>

                {/* Sidebar Bottom Quiet Telemetry & Shortcut Dock */}
                <div className="sidebar-footer">
                    <div
                        className="sidebar-desk-status"
                        title={connected ? 'Live monitoring stream connected' : 'Reconnecting to proctoring server'}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
                            <span className="sidebar-desk-status-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {connected ? 'Proctoring Synced' : 'Reconnecting…'}
                            </span>
                        </div>
                        <span className="sidebar-desk-status-text tabular-nums" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {liveSessionsList.length} live
                        </span>
                    </div>
                    <div className="sidebar-shortcuts-hint">
                        <span>Quick Search <kbd className="sidebar-kbd">Ctrl+K</kbd></span>
                        <span>Rail <kbd className="sidebar-kbd">Ctrl+B</kbd></span>
                    </div>
                </div>
            </aside>

            {/* Mobile Drawer Backdrop */}
            {mobileMenuOpen && (
                <div 
                    className="mobile-drawer-backdrop" 
                    onClick={() => setMobileMenuOpen(false)} 
                    aria-hidden="true" 
                />
            )}

            {/* 2. Fluent Workspace Canvas */}
            <div className="workspace-canvas">
                {/* Selective-Glass Top Navigation Header */}
                <header className="workspace-top-header">
                    <div className="workspace-top-header-left">
                        <button
                            className="mobile-hamburger-btn"
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            aria-label="Toggle navigation drawer"
                        >
                            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
                        </button>

                        <div className="header-welcome-block">
                            <span className="header-welcome-line">
                                {teacher?.name ? `Welcome back, ${teacher.name.split(/\s+/)[0]}` : 'Teacher Proctoring Desk'}
                            </span>
                            <span className="header-date-line">{formattedTodayDate}</span>
                        </div>

                        {activeExams.length > 0 && (
                            <button
                                type="button"
                                className="header-live-exam-chip"
                                onClick={() => { setActiveTab('monitoring'); setSelectedSummaryExamId(null); }}
                                title="View active examination monitoring"
                            >
                                <span className="status-dot connected" />
                                <span>
                                    {activeExams.length === 1
                                        ? `Live: ${activeExams[0].examCode}`
                                        : `${activeExams.length} Exams Running`}
                                </span>
                            </button>
                        )}

                        <div className="global-search-container" ref={searchBoxRef}>
                            <div className="frosted-search-bar">
                                <Search size={15} className="search-icon" />
                                <input
                                    id="workspace-global-search"
                                    type="text"
                                    placeholder="Search exams, candidates, alerts..."
                                    value={searchQuery}
                                    onFocus={() => setSearchFocused(true)}
                                    onChange={(e) => { setSearchQuery(e.target.value); setSearchFocused(true); }}
                                    aria-label="Search dashboard"
                                />
                                {searchQuery ? (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '2px' }}
                                        aria-label="Clear search"
                                    >
                                        <X size={13} />
                                    </button>
                                ) : (
                                    <kbd className="search-shortcut-badge">⌘K</kbd>
                                )}
                            </div>

                            {searchFocused && searchQuery.trim().length > 0 && (
                                <div className="global-search-dropdown" role="listbox">
                                    {!hasSearchMatches ? (
                                        <div className="search-empty-state">No matches found for "{searchQuery}"</div>
                                    ) : (
                                        <>
                                            {globalSearchResults.candidates.length > 0 && (
                                                <div className="search-result-group">
                                                    <div className="search-group-label">CANDIDATES</div>
                                                    {globalSearchResults.candidates.map(c => {
                                                        const sid = c.sessionId || c._id;
                                                        return (
                                                            <button
                                                                key={sid}
                                                                type="button"
                                                                className="search-result-item"
                                                                onClick={() => {
                                                                    setSelectedSessionId(sid);
                                                                    setActiveTab('monitoring');
                                                                    setRightPanelView('evidence');
                                                                    setSearchFocused(false);
                                                                    setSearchQuery('');
                                                                }}
                                                            >
                                                                <User size={14} className="search-result-icon" />
                                                                <div className="search-result-text">
                                                                    <strong>{c.studentName || c.studentId || 'Candidate'}</strong>
                                                                    <span>{c.rollNumber || sid.slice(0, 8)} • {c.examId}</span>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {globalSearchResults.exams.length > 0 && (
                                                <div className="search-result-group">
                                                    <div className="search-group-label">ACTIVE EXAMS</div>
                                                    {globalSearchResults.exams.map(ex => (
                                                        <button
                                                            key={ex._id || ex.examCode}
                                                            type="button"
                                                            className="search-result-item"
                                                            onClick={() => {
                                                                handleSelectExamForMonitoring(ex);
                                                                setSearchFocused(false);
                                                                setSearchQuery('');
                                                            }}
                                                        >
                                                            <Layers size={14} className="search-result-icon" />
                                                            <div className="search-result-text">
                                                                <strong>{ex.title}</strong>
                                                                <span>Code: {ex.examCode}</span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {globalSearchResults.alerts.length > 0 && (
                                                <div className="search-result-group">
                                                    <div className="search-group-label">RECENT ALERTS</div>
                                                    {globalSearchResults.alerts.map((v, idx) => (
                                                        <button
                                                            key={v._id || v.id || idx}
                                                            type="button"
                                                            className="search-result-item"
                                                            onClick={() => {
                                                                if (v.sessionId) setSelectedSessionId(v.sessionId);
                                                                setActiveTab('monitoring');
                                                                setRightPanelView('evidence');
                                                                setSearchFocused(false);
                                                                setSearchQuery('');
                                                            }}
                                                        >
                                                            <Zap size={14} className="search-result-icon" style={{ color: 'var(--danger)' }} />
                                                            <div className="search-result-text">
                                                                <strong>{String(v.type || 'Alert').replace(/_/g, ' ')}</strong>
                                                                <span>Severity {v.severity} • {new Date(v.timestamp).toLocaleTimeString()}</span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="workspace-top-header-right">
                        <button
                            type="button"
                            className="circular-frosted-btn"
                            onClick={() => { setActiveTab('monitoring'); setRightPanelView('priority'); }}
                            title={highAlertCount > 0 ? `${highAlertCount} high-priority alert(s) awaiting review` : 'Incident Center (No high-priority alerts)'}
                            aria-label="Open Incident Center notifications"
                        >
                            <Bell size={16} />
                            {highAlertCount > 0 && (
                                <span className="header-bell-badge tabular-nums">
                                    {highAlertCount > 9 ? '9+' : highAlertCount}
                                </span>
                            )}
                        </button>

                        <button
                            className="circular-frosted-btn"
                            onClick={() => setSoundEnabled(!soundEnabled)}
                            title={soundEnabled ? "Alert Sound ON (Click to Mute)" : "Alert Sound Muted (Click to Unmute)"}
                            aria-label="Toggle alert chime"
                        >
                            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                        </button>

                        <button
                            className="circular-frosted-btn"
                            onClick={onToggleTheme}
                            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                            aria-label="Toggle color theme"
                        >
                            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                        </button>

                        {/* User Profile / Auth Action */}
                        {teacher ? (
                            <div className="user-profile-pill">
                                <div className={`profile-avatar ${teacher.role === 'admin' ? 'admin' : 'examiner'}`}>
                                    {teacher.name ? teacher.name.charAt(0).toUpperCase() : 'T'}
                                </div>
                                <div className="profile-text">
                                    <span className="profile-name">{teacher.name}</span>
                                    <span className="profile-role">
                                        {teacher.role === 'admin' ? 'Administrator' : 'Examiner'}
                                    </span>
                                </div>
                                <button
                                    onClick={logout}
                                    title="Sign Out"
                                    className="profile-logout-btn"
                                    aria-label="Sign out"
                                >
                                    <LogOut size={13} />
                                </button>
                            </div>
                        ) : (
                            <div className="auth-header-group">
                                {import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => demoLogin('admin')}
                                            className="frosted-secondary-btn pill-btn"
                                        >
                                            <Shield size={13} />
                                            <span>Demo Admin</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => demoLogin('teacher')}
                                            className="frosted-secondary-btn pill-btn"
                                        >
                                            <Sparkles size={13} />
                                            <span>Demo Teacher</span>
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setShowAuthModal(true)}
                                    className="solid-primary-btn pill-btn"
                                >
                                    <Lock size={13} />
                                    <span>Sign In</span>
                                </button>
                            </div>
                        )}
                    </div>
                </header>

                {/* Global Proactive 5-Minute Exam Expiry Notification & Time Extension Banner */}
                <ExamTimeExpiryAlert
                    authFetch={authFetch}
                    socket={socket}
                    soundEnabled={soundEnabled}
                    playAlertChime={playAlertChime}
                />

                {/* 3. Workspace Scrollable Body */}
                <div className="workspace-scroll-area">
                    {/* Page Header */}
                    <div className="workspace-page-header">
                        <div className="page-header-titles">
                            <h2 className="page-header-title">
                                {activeTab === 'monitoring'
                                    ? 'Live Monitoring Desk'
                                    : (activeTab === 'exams' || activeTab === 'history') && selectedSummaryExamId
                                    ? 'Exam Performance & Analytics'
                                    : activeTab === 'exams'
                                    ? 'Exam Orchestration'
                                    : activeTab === 'history'
                                    ? 'Archived Assessment Records'
                                    : 'Administration & Storage Console'}
                            </h2>
                            <p className="page-header-subtitle">
                                {activeTab === 'monitoring'
                                    ? 'Real-time AI integrity feed, biometric telemetry & candidate sessions'
                                    : (activeTab === 'exams' || activeTab === 'history') && selectedSummaryExamId
                                    ? 'Comprehensive student violation timeline and integrity review'
                                    : activeTab === 'exams'
                                    ? 'Schedule exams, enforce secondary camera pairing, and release papers'
                                    : activeTab === 'history'
                                    ? 'Archived test sessions, verified audit logs, and completed reports'
                                    : 'Cloud asset management, automated cleanup, and account administration'}
                            </p>
                        </div>

                        <div className="page-header-actions">
                            {activeTab === 'monitoring' && (
                                <button
                                    type="button"
                                    className="frosted-secondary-btn pill-btn"
                                    onClick={toggleFocusMode}
                                    title={focusMode ? 'Expand KPI cards' : 'Compact KPI bar for more vertical space'}
                                >
                                    {focusMode ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                                    <span>{focusMode ? 'Show KPIs' : 'Focus Mode'}</span>
                                </button>
                            )}
                            {selectedExamFilter && activeTab === 'monitoring' ? (
                                <>
                                    <button
                                        type="button"
                                        className="frosted-secondary-btn pill-btn"
                                        onClick={() => handleExamFilterChange(null)}
                                        title="Clear exam filter to view all active exams"
                                    >
                                        <span>Filter: {selectedExamFilter}</span>
                                        <X size={13} />
                                    </button>
                                    {focusMode && (
                                        <button
                                            className="solid-danger-btn pill-btn"
                                            onClick={() => requestEndExam(selectedExamFilter)}
                                        >
                                            <CheckCircle size={14} />
                                            <span>End Exam</span>
                                        </button>
                                    )}
                                </>
                            ) : activeTab === 'monitoring' ? (
                                <>
                                    <button
                                        className="frosted-secondary-btn pill-btn"
                                        onClick={() => { setSelectedSummaryExamId(null); setActiveTab('history'); }}
                                    >
                                        <CheckCircle size={14} />
                                        <span>Past Records</span>
                                    </button>
                                    <button
                                        className="solid-primary-btn pill-btn"
                                        onClick={() => { setSelectedSummaryExamId(null); setActiveTab('exams'); }}
                                    >
                                        <Layers size={14} />
                                        <span>Manage Exams</span>
                                    </button>
                                </>
                            ) : (activeTab === 'exams' || activeTab === 'history') && selectedSummaryExamId ? (
                                <button
                                    className="frosted-secondary-btn pill-btn"
                                    onClick={() => setSelectedSummaryExamId(null)}
                                >
                                    ← Back to {activeTab === 'history' ? 'History' : 'Exams'}
                                </button>
                            ) : null}
                        </div>
                    </div>

                    {/* 4. 4-Column Teacher-Focused KPI Grid or Compact Focus Strip */}
                    {activeTab === 'monitoring' && (
                        focusMode ? (
                            <div className="focus-kpi-strip">
                                <button type="button" className="focus-kpi-pill" onClick={() => { setSelectedSummaryExamId(null); setActiveTab('exams'); }}>
                                    <Layers size={14} style={{ color: 'var(--primary)' }} />
                                    <strong className="tabular-nums">{activeExams.length}</strong> Active Exams
                                </button>
                                <button type="button" className="focus-kpi-pill" onClick={() => setRightPanelView('grid')}>
                                    <Users size={14} style={{ color: 'var(--success)' }} />
                                    <strong className="tabular-nums">{liveSessionsList.length}</strong> Connected Students
                                </button>
                                <button type="button" className="focus-kpi-pill" onClick={() => setRightPanelView('priority')}>
                                    <ShieldAlert size={14} style={{ color: studentsRequiringReviewCount > 0 ? 'var(--danger)' : 'var(--success)' }} />
                                    <strong className="tabular-nums">{studentsRequiringReviewCount}</strong> Requiring Review
                                </button>
                                <button type="button" className="focus-kpi-pill" onClick={() => setRightPanelView('grid')}>
                                    <Wifi size={14} style={{ color: stableConnectionsStats.pct >= 90 ? 'var(--success)' : 'var(--warning)' }} />
                                    <strong className="tabular-nums">{stableConnectionsStats.pct}%</strong> Stable Connections
                                </button>
                            </div>
                        ) : (
                        <div className="kpi-grid-4col">
                            <div
                                className="elevated-kpi-card clickable"
                                role="button"
                                tabIndex={0}
                                onClick={() => { setSelectedSummaryExamId(null); setActiveTab('exams'); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedSummaryExamId(null); setActiveTab('exams'); } }}
                                title="Click to manage active exams"
                            >
                                <div className="kpi-card-top">
                                    <div className="kpi-icon-badge exams">
                                        <Layers size={17} />
                                    </div>
                                    <span className={`kpi-trend-pill ${activeExams.length > 0 ? 'emerald' : 'amber'}`}>
                                        <span className={`kpi-status-dot ${activeExams.length > 0 ? 'emerald' : 'amber'}`} />
                                        <span>{activeExams.length > 0 ? 'In Progress' : 'Standby'}</span>
                                    </span>
                                </div>
                                <div className="kpi-metric-val tabular-nums">
                                    {activeExams.length}
                                </div>
                                <div className="kpi-label-group">
                                    <span className="kpi-label-title">Active Exams</span>
                                    <span className="kpi-label-caption">Currently scheduled &amp; open</span>
                                </div>
                            </div>

                            <div
                                className="elevated-kpi-card clickable"
                                role="button"
                                tabIndex={0}
                                onClick={() => setRightPanelView('grid')}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRightPanelView('grid'); } }}
                                title="Click to open Live Monitoring Grid"
                            >
                                <div className="kpi-card-top">
                                    <div className="kpi-icon-badge students">
                                        <Users size={17} />
                                    </div>
                                    <span className="kpi-trend-pill emerald">
                                        <span className="kpi-status-dot emerald" />
                                        <span>Live Sessions</span>
                                    </span>
                                </div>
                                <div className="kpi-metric-val tabular-nums">
                                    {liveSessionsList.length}
                                </div>
                                <div className="kpi-label-group">
                                    <span className="kpi-label-title">Connected Students</span>
                                    <span className="kpi-label-caption">Active exam participants online</span>
                                </div>
                            </div>

                            <div
                                className="elevated-kpi-card clickable"
                                role="button"
                                tabIndex={0}
                                onClick={() => setRightPanelView('priority')}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRightPanelView('priority'); } }}
                                title="Click to open Incident Center"
                            >
                                <div className="kpi-card-top">
                                    <div className="kpi-icon-badge alerts">
                                        <ShieldAlert size={17} />
                                    </div>
                                    <span className={`kpi-trend-pill ${studentsRequiringReviewCount > 0 ? 'rose' : 'emerald'}`}>
                                        <span className={`kpi-status-dot ${studentsRequiringReviewCount > 0 ? 'rose' : 'emerald'}`} />
                                        <span>{highAlertCount > 0 ? `${highAlertCount} High Priority` : studentsRequiringReviewCount > 0 ? 'Pending Triage' : 'All Clear'}</span>
                                    </span>
                                </div>
                                <div className="kpi-metric-val tabular-nums">
                                    {studentsRequiringReviewCount}
                                </div>
                                <div className="kpi-label-group">
                                    <span className="kpi-label-title">Students Requiring Review</span>
                                    <span className="kpi-label-caption">Unreviewed alerts or elevated risk</span>
                                </div>
                            </div>

                            <div
                                className="elevated-kpi-card clickable"
                                role="button"
                                tabIndex={0}
                                onClick={() => setRightPanelView('grid')}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRightPanelView('grid'); } }}
                                title="Click to inspect candidate connection status"
                            >
                                <div className="kpi-card-top">
                                    <div className="kpi-icon-badge mesh">
                                        <Wifi size={17} />
                                    </div>
                                    <span className={`kpi-trend-pill ${!connected || stableConnectionsStats.pct < 85 ? 'amber' : 'emerald'}`}>
                                        <span className={`kpi-status-dot ${!connected || stableConnectionsStats.pct < 85 ? 'amber' : 'emerald'}`} />
                                        <span>{!connected ? 'Reconnecting' : stableConnectionsStats.total === 0 ? 'Ready' : `${stableConnectionsStats.stable}/${stableConnectionsStats.total} Stable`}</span>
                                    </span>
                                </div>
                                <div className="kpi-metric-val tabular-nums">
                                    {connected ? `${stableConnectionsStats.pct}%` : 'Syncing'}
                                </div>
                                <div className="kpi-label-group">
                                    <span className="kpi-label-title">Stable Candidate Connections</span>
                                    <span className="kpi-label-caption">Uninterrupted camera &amp; session links</span>
                                </div>
                            </div>
                        </div>
                        )
                    )}

                    {/* 4B. Active Examination Overview Banner */}
                    {activeTab === 'monitoring' && activeExams.length > 0 && !focusMode && (
                        <ActiveExamOverview
                            activeExams={activeExams}
                            activeSessions={activeSessions}
                            selectedExamFilter={selectedExamFilter}
                            onSelectExamFilter={handleExamFilterChange}
                            onRequestEndExam={requestEndExam}
                            onRefresh={refreshLiveOverviewNow}
                            authFetch={authFetch}
                        />
                    )}

                    {/* Content View Switching */}
                    {activeTab === 'admin' ? (
                        <main className="elevated-content-card">
                            <AdminDashboard
                                connected={connected}
                                socket={socket}
                                onNavigateExams={() => setActiveTab('exams')}
                                onNavigateMonitoring={() => setActiveTab('monitoring')}
                            />
                        </main>
                    ) : activeTab === 'exams' || activeTab === 'history' ? (
                        <main className="elevated-content-card">
                            {selectedSummaryExamId ? (
                                <ExamSummary
                                    examId={selectedSummaryExamId}
                                    onBack={() => setSelectedSummaryExamId(null)}
                                />
                            ) : (
                                <ExamManager
                                    onSelectExamForMonitoring={handleSelectExamForMonitoring}
                                    onSelectExamSummary={handleSelectExamSummary}
                                    historyOnly={activeTab === 'history'}
                                />
                            )}
                        </main>
                    ) : !activeExamsLoaded ? (
                        <main className="elevated-content-card" style={{ gap: '14px' }}>
                            <div className="skeleton-line" style={{ width: '36%', height: '20px' }} />
                            <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: '16px', flex: 1 }}>
                                <div className="skeleton-box" style={{ height: '320px' }} />
                                <div className="skeleton-box" style={{ height: '320px' }} />
                            </div>
                        </main>
                    ) : activeExams.length === 0 ? (
                        <main className="elevated-content-card live-empty-main">
                            <section className="live-empty-state" aria-labelledby="live-empty-title">
                                <div className="live-empty-orbit" aria-hidden="true"><span /><Radio size={28} /></div>
                                <span className="live-empty-kicker">LIVE OPERATIONS</span>
                                <h2 id="live-empty-title">Your monitoring desk is clear</h2>
                                <p>No exams are active right now. Create or activate an exam to bring candidates, alerts, and evidence into this view.</p>
                                <button className="solid-primary-btn pill-btn" onClick={() => setActiveTab('exams')}>
                                    <Layers size={17} /> Go to Exams
                                </button>
                                <div className="live-empty-footer"><span className="status-dot connected" /> Ready when your next exam begins</div>
                            </section>
                        </main>
                    ) : (
                        /* 5. Asymmetric Data Visualization Row (5 cols / 7 cols) */
                        <main className={`asymmetric-data-grid ${focusMode ? 'focus-expanded' : ''}`}>
                            {/* Left Column: Student List */}
                            <div className="asymmetric-col-left">
                                <StudentList
                                    secondaryCameraStatuses={secondaryCameraStatuses}
                                    secondaryCameraMeta={secondaryCameraMeta}
                                    riskScores={riskScores}
                                    violations={violations}
                                    onSelectStudent={setSelectedSessionId}
                                    selectedSessionId={selectedSessionId}
                                    examFilter={selectedExamFilter}
                                />
                            </div>

                            {/* Right Column: Priority Queue / Feed / Grid / Evidence / Chat */}
                            <div className="asymmetric-col-right">
                                <div className="right-panel-header">
                                    <h3 className="right-panel-title">
                                        {rightPanelView === 'priority'
                                            ? 'Cross-Student Priority Queue'
                                            : rightPanelView === 'feed'
                                            ? 'Real-Time Alert Feed'
                                            : rightPanelView === 'grid'
                                            ? 'Candidate Webcam Grid'
                                            : rightPanelView === 'chat'
                                            ? `Exam Chat & Inquiries (${selectedExamFilter || 'Active Exam'})`
                                            : `Evidence Review: ${selectedSessionId || ''}`}
                                    </h3>

                                    <div className="sub-tabs-pills">
                                        <button
                                            className={`sub-tab-pill ${rightPanelView === 'priority' ? 'active' : ''}`}
                                            onClick={() => setRightPanelView('priority')}
                                        >
                                            <Zap size={13} style={{ color: rightPanelView === 'priority' ? '#ef4444' : 'currentColor' }} />
                                            <span>Priority Queue</span>
                                            {highAlertCount > 0 && (
                                                <span className="sub-tab-badge danger tabular-nums">{highAlertCount}</span>
                                            )}
                                        </button>
                                        <button
                                            className={`sub-tab-pill ${rightPanelView === 'feed' ? 'active' : ''}`}
                                            onClick={() => setRightPanelView('feed')}
                                        >
                                            Live Feed
                                        </button>
                                        <button
                                            className={`sub-tab-pill ${rightPanelView === 'grid' ? 'active' : ''}`}
                                            onClick={() => setRightPanelView('grid')}
                                        >
                                            Webcam Grid
                                        </button>
                                        <button
                                            className={`sub-tab-pill ${rightPanelView === 'evidence' ? 'active' : ''}`}
                                            onClick={() => setRightPanelView('evidence')}
                                            disabled={!selectedSessionId}
                                        >
                                            Evidence Review
                                        </button>
                                        <button
                                            className={`sub-tab-pill ${rightPanelView === 'chat' ? 'active' : ''}`}
                                            onClick={() => { setRightPanelView('chat'); setUnreadChatCount(0); }}
                                        >
                                            <span>Exam Chat</span>
                                            {unreadChatCount > 0 && (
                                                <span className="sub-tab-badge primary tabular-nums">{unreadChatCount}</span>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="right-panel-content">
                                    {rightPanelView === 'priority' ? (
                                        <PriorityQueue
                                            socket={socket}
                                            examFilter={selectedExamFilter}
                                            onSelectExamFilter={handleExamFilterChange}
                                            onSelectStudentForReview={(sid) => {
                                                setSelectedSessionId(sid);
                                                setRightPanelView('evidence');
                                            }}
                                        />
                                    ) : rightPanelView === 'feed' ? (
                                        <AlertFeed
                                            violations={violations}
                                            examFilter={selectedExamFilter}
                                            sessionId={selectedSessionId}
                                            activeExams={activeExams}
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
                                            secondaryCameraStatuses={secondaryCameraStatuses}
                                            secondaryCameraMeta={secondaryCameraMeta}
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
                                            activeExams={activeExams}
                                            initialSessionId={chatSessionId}
                                            activeSessions={selectedExamFilter
                                                ? activeSessions.filter(s => String(s.examId || '').toUpperCase() === String(selectedExamFilter).toUpperCase())
                                                : activeSessions}
                                            socket={socket}
                                        />
                                    ) : (
                                        <EvidenceViewer
                                            sessionId={selectedSessionId}
                                            liveViolations={violations}
                                            secondaryCameraMeta={secondaryCameraMeta[selectedSessionId] || null}
                                        />
                                    )}
                                </div>
                            </div>
                        </main>
                    )}
                </div>
            </div>

            {/* End Exam Confirmation Modal */}
            {showEndExamConfirm && (
                <ModalPortal>
                <div className="md-modal-overlay" onClick={() => !endingExam && setShowEndExamConfirm(false)}>
                    <div className="md-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="md-modal-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
                            <h3 style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                <AlertCircle size={20} /> End Current Exam ({endExamTargetCode || selectedExamFilter})?
                            </h3>
                            <button className="md-icon-btn" disabled={endingExam} onClick={() => setShowEndExamConfirm(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.5' }}>
                            End the exam session for code <strong>"{endExamTargetCode || selectedExamFilter}"</strong>?
                            <p style={{ marginTop: '8px', color: 'var(--text-main)', fontWeight: '500' }}>
                                Students will no longer be able to join or submit. Active candidate sessions will be moved to completed archives.
                            </p>
                        </div>
                        {endExamError && <p role="alert" style={{ color: 'var(--danger)' }}>{endExamError}</p>}
                        <div className="md-modal-actions">
                            <button className="frosted-secondary-btn pill-btn" disabled={endingExam} onClick={() => setShowEndExamConfirm(false)}>
                                Cancel
                            </button>
                            <button className="solid-danger-btn pill-btn" disabled={endingExam} onClick={handleEndCurrentExam}>
                                {endingExam ? 'Ending Exam…' : 'Confirm End Exam'}
                            </button>
                        </div>
                    </div>
                </div>
                </ModalPortal>
            )}

            {/* Examiner Auth Modal */}
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </div>
    );
}
