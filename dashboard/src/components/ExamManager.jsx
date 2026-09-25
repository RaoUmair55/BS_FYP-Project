import React, { useState, useEffect } from 'react';
import { FileText, Plus, Play, CheckCircle, Clock, Users, X, AlertCircle, Eye, BarChart2, Radio, Trash2, Lock, Sparkles, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Components.css';

const API_BASE = 'http://localhost:5000';

const SOFTWARE_PRESETS = [
    { id: 'vscode', name: 'Visual Studio Code', executable: 'code.exe', category: 'IDE & Coding', icon: '💻' },
    { id: 'codeblocks', name: 'Code::Blocks', executable: 'codeblocks.exe', category: 'IDE & Coding', icon: '🧱' },
    { id: 'devcpp', name: 'Dev-C++', executable: 'devcpp.exe', category: 'IDE & Coding', icon: '⚡' },
    { id: 'clion', name: 'CLion (C/C++)', executable: 'clion64.exe', category: 'IDE & Coding', icon: '⚙️' },
    { id: 'pycharm', name: 'PyCharm', executable: 'pycharm64.exe', category: 'IDE & Coding', icon: '🐍' },
    { id: 'notepadpp', name: 'Notepad++', executable: 'notepad++.exe', category: 'IDE & Coding', icon: '📝' },
    { id: 'eclipse', name: 'Eclipse IDE', executable: 'eclipse.exe', category: 'IDE & Coding', icon: '🌙' },
    { id: 'intellij', name: 'IntelliJ IDEA', executable: 'idea64.exe', category: 'IDE & Coding', icon: '💡' },
    { id: 'winword', name: 'Microsoft Word', executable: 'winword.exe', category: 'Office & Text', icon: '📄' },
    { id: 'excel', name: 'Microsoft Excel', executable: 'excel.exe', category: 'Office & Text', icon: '📊' },
    { id: 'notepad', name: 'Windows Notepad', executable: 'notepad.exe', category: 'Office & Text', icon: '🗒️' },
    { id: 'calc', name: 'Windows Calculator', executable: 'CalculatorApp.exe', category: 'Math & Tools', icon: '🧮' },
    { id: 'matlab', name: 'MATLAB', executable: 'matlab.exe', category: 'Math & Tools', icon: '📐' }
];

export default function ExamManager({ onSelectExamForMonitoring, onSelectExamSummary }) {
    const { authFetch, teacher, accessToken, setShowAuthModal, demoLogin } = useAuth();
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState('active'); // 'active' | 'completed'
    const [scopeFilter, setScopeFilter] = useState('all'); // 'all' | 'mine'

    // Confirmation dialog state for ending an exam
    const [endExamModalData, setEndExamModalData] = useState(null); // { id, title }
    // Confirmation dialog state for deleting an exam
    const [deleteExamModalData, setDeleteExamModalData] = useState(null); // { id, title, code }

    // Form state
    const [title, setTitle] = useState('');
    const [customCode, setCustomCode] = useState('');
    const [status, setStatus] = useState('active');
    const [durationMinutes, setDurationMinutes] = useState(60);
    const [detectCellPhone, setDetectCellPhone] = useState(true);
    const [detectMultiplePersons, setDetectMultiplePersons] = useState(true);
    const [enforceAppWhitelist, setEnforceAppWhitelist] = useState(true);
    const [detectLookingAway, setDetectLookingAway] = useState(true);
    const [autoTerminateRiskScore, setAutoTerminateRiskScore] = useState(80);

    // Allowed Applications state
    const [allowedApps, setAllowedApps] = useState([]);
    const [customAppName, setCustomAppName] = useState('');
    const [customAppExe, setCustomAppExe] = useState('');

    const [paperFile, setPaperFile] = useState(null);
    const [formError, setFormError] = useState(null);

    const togglePresetApp = (preset) => {
        setAllowedApps(prev => {
            const exists = prev.some(a => a.executable.toLowerCase() === preset.executable.toLowerCase());
            if (exists) {
                return prev.filter(a => a.executable.toLowerCase() !== preset.executable.toLowerCase());
            } else {
                return [...prev, {
                    id: preset.id,
                    name: preset.name,
                    executable: preset.executable,
                    category: preset.category
                }];
            }
        });
    };

    const handleAddCustomApp = () => {
        if (!customAppExe.trim()) return;
        let exe = customAppExe.trim().toLowerCase();
        if (!exe.endsWith('.exe')) {
            exe = `${exe}.exe`;
        }
        const name = customAppName.trim() || customAppExe.trim();
        
        if (allowedApps.some(a => a.executable.toLowerCase() === exe)) {
            return;
        }

        setAllowedApps(prev => [...prev, {
            id: `custom_${Date.now()}`,
            name,
            executable: exe,
            category: 'Custom Software'
        }]);

        setCustomAppName('');
        setCustomAppExe('');
    };

    const handleRemoveAllowedApp = (executable) => {
        setAllowedApps(prev => prev.filter(a => a.executable.toLowerCase() !== executable.toLowerCase()));
    };

    useEffect(() => {
        fetchExams();
        const interval = setInterval(fetchExams, 5000); // Polling every 5s
        return () => clearInterval(interval);
    }, [teacher, accessToken]);

    const fetchExams = async () => {
        if (!teacher && !accessToken) {
            setError('Examiner authentication required to view and manage exams.');
            setExams([]);
            setLoading(false);
            return;
        }

        try {
            const res = await authFetch(`${API_BASE}/exams`);
            if (res.status === 401) {
                setError('Examiner authentication required to view and manage exams.');
                setExams([]);
                return;
            }
            if (!res.ok) throw new Error('Failed to load exams');
            const data = await res.json();
            setExams(data);
            setError(null);
        } catch (err) {
            console.error('Error loading exams:', err);
            setError('Could not connect to backend server.');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateExam = async (e) => {
        e.preventDefault();
        if (!title.trim()) {
            setFormError('Exam title is required.');
            return;
        }

        setSubmitting(true);
        setFormError(null);

        try {
            const formData = new FormData();
            formData.append('title', title.trim());
            if (customCode.trim()) {
                formData.append('examCode', customCode.trim().toUpperCase());
            }
            formData.append('status', status);
            formData.append('durationMinutes', durationMinutes);
            formData.append('rules', JSON.stringify({
                detectCellPhone,
                detectMultiplePersons,
                enforceAppWhitelist,
                detectLookingAway,
                autoTerminateRiskScore: Number(autoTerminateRiskScore)
            }));

            if (paperFile) {
                formData.append('paper', paperFile);
            }

            formData.append('allowedApplications', JSON.stringify(allowedApps));

            const res = await authFetch(`${API_BASE}/exams`, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to create exam');
            }

            // Success
            setTitle('');
            setCustomCode('');
            setStatus('active');
            setPaperFile(null);
            setAllowedApps([]);
            setCustomAppName('');
            setCustomAppExe('');
            setShowModal(false);
            fetchExams();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdateStatus = async (examId, newStatus) => {
        try {
            const res = await authFetch(`${API_BASE}/exams/${examId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            if (res.ok) {
                fetchExams();
            }
        } catch (err) {
            console.error('Failed to update status:', err);
        } finally {
            setEndExamModalData(null);
        }
    };

    const handleDeleteExam = async (examId) => {
        try {
            const res = await authFetch(`${API_BASE}/exams/${examId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                fetchExams();
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to delete exam');
            }
        } catch (err) {
            console.error('Failed to delete exam:', err);
        } finally {
            setDeleteExamModalData(null);
        }
    };

    const [releasingMap, setReleasingMap] = useState({});

    const handleReleasePaper = async (examId) => {
        if (!examId) return;
        setReleasingMap(prev => ({ ...prev, [examId]: true }));
        try {
            const res = await authFetch(`${API_BASE}/exams/${examId}/release-paper`, {
                method: 'POST'
            });
            if (res.ok) {
                fetchExams();
            } else {
                const data = await res.json().catch(() => ({}));
                alert(data.error || 'Failed to release question paper');
            }
        } catch (err) {
            console.error('Failed to release question paper:', err);
        } finally {
            setReleasingMap(prev => ({ ...prev, [examId]: false }));
        }
    };

    const activeExams = exams.filter(e => e.status === 'active' || e.status === 'draft');
    const completedExams = exams.filter(e => e.status === 'completed');
    const baseExams = activeTab === 'active' ? activeExams : completedExams;
    const displayedExams = scopeFilter === 'mine' ? baseExams.filter(e => e.isMine) : baseExams;
    const myExamsCount = baseExams.filter(e => e.isMine).length;

    return (
        <div className="exam-manager-container">
            <div className="section-header">
                <div>
                    <h2 className="md-title">Exam Management</h2>
                    <p className="md-subtitle">Create, configure, monitor active exams, and review historical exam analytics</p>
                </div>
                <button className="md-btn md-btn-primary" onClick={() => setShowModal(true)}>
                    <Plus size={18} />
                    <span>Create Exam</span>
                </button>
            </div>

            {/* Material Design Tab Filter & Scope Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                <div className="exam-tabs-bar" style={{ margin: 0 }}>
                    <button 
                        className={`exam-tab-btn ${activeTab === 'active' ? 'active' : ''}`}
                        onClick={() => setActiveTab('active')}
                    >
                        <Radio size={16} />
                        <span>Active & Draft Exams</span>
                        <span className="tab-count-pill">{activeExams.length}</span>
                    </button>
                    <button 
                        className={`exam-tab-btn ${activeTab === 'completed' ? 'active' : ''}`}
                        onClick={() => setActiveTab('completed')}
                    >
                        <CheckCircle size={16} />
                        <span>Completed & Historical Exams</span>
                        <span className="tab-count-pill">{completedExams.length}</span>
                    </button>
                </div>

                {/* Scope Filter: All vs Created By Me */}
                {teacher && (
                    <div style={{
                        display: 'flex',
                        background: 'var(--bg-base, #f1f3f4)',
                        padding: '3px',
                        borderRadius: '20px',
                        border: '1px solid var(--border-color, #dadce0)'
                    }}>
                        <button
                            type="button"
                            onClick={() => setScopeFilter('all')}
                            style={{
                                padding: '5px 12px',
                                borderRadius: '16px',
                                border: 'none',
                                background: scopeFilter === 'all' ? '#ffffff' : 'transparent',
                                color: scopeFilter === 'all' ? '#1a73e8' : '#5f6368',
                                fontWeight: scopeFilter === 'all' ? 600 : 400,
                                fontSize: '12px',
                                cursor: 'pointer',
                                boxShadow: scopeFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            All Department Exams ({baseExams.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setScopeFilter('mine')}
                            style={{
                                padding: '5px 12px',
                                borderRadius: '16px',
                                border: 'none',
                                background: scopeFilter === 'mine' ? '#ffffff' : 'transparent',
                                color: scopeFilter === 'mine' ? '#1a73e8' : '#5f6368',
                                fontWeight: scopeFilter === 'mine' ? 600 : 400,
                                fontSize: '12px',
                                cursor: 'pointer',
                                boxShadow: scopeFilter === 'mine' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            Created by Me ({myExamsCount})
                        </button>
                    </div>
                )}
            </div>

            {error && (
                <div className="md-alert md-alert-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                    {!teacher && (
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                type="button"
                                className="md-btn md-btn-sm md-btn-primary"
                                onClick={() => demoLogin().then(fetchExams)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <Sparkles size={14} />
                                <span>⚡ Quick Demo Login</span>
                            </button>
                            <button
                                type="button"
                                className="md-btn md-btn-sm md-btn-outlined"
                                onClick={() => setShowAuthModal(true)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <Lock size={14} />
                                <span>Sign In</span>
                            </button>
                        </div>
                    )}
                </div>
            )}

            {loading ? (
                <div className="md-loading">Loading exams...</div>
            ) : displayedExams.length === 0 ? (
                <div className="md-empty-card">
                    <FileText size={48} className="md-empty-icon" />
                    <h3>{activeTab === 'active' ? 'No Active Exams' : 'No Completed Exams'}</h3>
                    <p>
                        {activeTab === 'active' 
                            ? 'Click "Create Exam" above to set up your first exam code and question paper.' 
                            : 'Completed exams will appear here once an active exam session is ended.'}
                    </p>
                    {activeTab === 'active' && (
                        <button className="md-btn md-btn-primary" onClick={() => setShowModal(true)} style={{ marginTop: '16px' }}>
                            <Plus size={18} />
                            <span>Create First Exam</span>
                        </button>
                    )}
                </div>
            ) : (
                <div className="exam-card-grid">
                    {displayedExams.map((exam) => {
                        const isLive = exam.status === 'active';
                        const isCompleted = exam.status === 'completed';

                        return (
                            <div 
                                key={exam._id} 
                                className={`md-card exam-card ${isCompleted ? 'completed-card' : ''}`}
                            >
                                <div className="exam-card-top">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <div className="exam-code-badge">{exam.examCode}</div>
                                        {exam.isMine ? (
                                            <span className="md-badge" style={{ background: '#e8f0fe', color: '#1a73e8', fontWeight: 600, fontSize: '11px', padding: '2px 8px' }}>
                                                Created by You
                                            </span>
                                        ) : exam.createdByName ? (
                                            <span style={{ fontSize: '11px', color: '#5f6368' }}>
                                                By: {exam.createdByName}
                                            </span>
                                        ) : null}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span className={`md-badge ${isLive ? 'status-active live-pulse' : isCompleted ? 'status-completed' : 'status-draft'}`}>
                                            {isLive && <span className="live-dot" />}
                                            {isLive && <span>LIVE</span>}
                                            {isCompleted && <CheckCircle size={12} />}
                                            {isCompleted && <span>COMPLETED</span>}
                                            {exam.status === 'draft' && <Clock size={12} />}
                                            {exam.status === 'draft' && <span>DRAFT</span>}
                                        </span>
                                        {isLive && exam.paperPath && !exam.paperReleased && (
                                            <span className="md-badge" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 600, fontSize: '11px', padding: '2px 8px' }}>
                                                🔒 Lobby
                                            </span>
                                        )}
                                        {isLive && exam.paperPath && exam.paperReleased && (
                                            <span className="md-badge" style={{ background: '#ecfdf5', color: '#047857', fontWeight: 600, fontSize: '11px', padding: '2px 8px' }}>
                                                ✓ Unlocked
                                            </span>
                                        )}
                                        <button 
                                            className="md-icon-btn btn-delete-icon"
                                            onClick={() => setDeleteExamModalData({ id: exam._id, title: exam.title, code: exam.examCode })}
                                            title="Delete Exam"
                                            style={{ color: '#d93025' }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                <h3 className="exam-card-title">{exam.title}</h3>

                                <div className="exam-card-meta">
                                    <div className="meta-item">
                                        <FileText size={15} />
                                        <span>{exam.paperFilename || 'No paper attached'}</span>
                                    </div>
                                    <div className="meta-item">
                                        <Users size={15} />
                                        <span>{exam.activeStudents || 0} Candidates {isLive ? 'Live' : 'Participated'}</span>
                                    </div>
                                    <div className="meta-item">
                                        <Clock size={15} />
                                        <span>{exam.durationMinutes ? `${exam.durationMinutes} Mins` : 'Untimed'} &bull; {new Date(exam.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    {exam.rules && (
                                        <div className="meta-item" style={{ fontSize: '11px', color: '#5f6368', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                                            {exam.rules.detectCellPhone && <span className="md-badge" style={{ background: '#e8f0fe', color: '#1a73e8', padding: '1px 6px' }}>📱 Mobile</span>}
                                            {exam.rules.detectMultiplePersons && <span className="md-badge" style={{ background: '#fce8e6', color: '#d93025', padding: '1px 6px' }}>👥 Multi-Person</span>}
                                            {exam.rules.enforceAppWhitelist && <span className="md-badge" style={{ background: '#e6f4ea', color: '#137333', padding: '1px 6px' }}>🖥️ Whitelist</span>}
                                            {exam.rules.autoTerminateRiskScore > 0 && <span className="md-badge" style={{ background: '#fef7e0', color: '#b06000', padding: '1px 6px' }}>⚠️ Alert Threshold ({exam.rules.autoTerminateRiskScore})</span>}
                                        </div>
                                    )}

                                    {exam.allowedApplications && exam.allowedApplications.length > 0 ? (
                                        <div className="meta-item" style={{ fontSize: '11px', color: '#1a73e8', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                                            <span style={{ fontWeight: 600, color: '#3c4043' }}>Allowed Tools:</span>
                                            {exam.allowedApplications.map(app => (
                                                <span key={app.executable} className="md-badge" style={{ background: '#e8f0fe', color: '#1a73e8', padding: '1px 6px' }}>
                                                    {app.name || app.executable}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="meta-item" style={{ fontSize: '11px', color: '#5f6368', marginTop: '4px' }}>
                                            <span className="md-badge" style={{ background: '#f1f3f4', color: '#5f6368', padding: '1px 6px' }}>
                                                🔒 Strict Lockdown (0 External Apps)
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="exam-card-actions">
                                    {exam.status === 'draft' && (
                                        <button 
                                            className="md-btn md-btn-outlined md-btn-sm" 
                                            onClick={() => handleUpdateStatus(exam._id, 'active')}
                                        >
                                            <Play size={14} />
                                            <span>Activate</span>
                                        </button>
                                    )}

                                    {isLive && (
                                        <>
                                            {exam.paperPath && !exam.paperReleased && (
                                                <button 
                                                    className="md-btn md-btn-sm" 
                                                    style={{ 
                                                        background: '#2563eb', 
                                                        color: '#ffffff', 
                                                        fontWeight: 600,
                                                        border: 'none',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}
                                                    disabled={releasingMap[exam.examCode || exam._id]}
                                                    onClick={() => handleReleasePaper(exam.examCode || exam._id)}
                                                >
                                                    <Send size={14} />
                                                    <span>{releasingMap[exam.examCode || exam._id] ? 'Releasing...' : '🚀 Release Paper & Start Exam'}</span>
                                                </button>
                                            )}
                                            <button 
                                                className="md-btn md-btn-outlined md-btn-sm btn-end-exam" 
                                                onClick={() => setEndExamModalData({ id: exam._id, title: exam.title })}
                                            >
                                                <CheckCircle size={14} />
                                                <span>End Exam</span>
                                            </button>
                                            <button 
                                                className="md-btn md-btn-primary md-btn-sm" 
                                                onClick={() => onSelectExamForMonitoring && onSelectExamForMonitoring(exam)}
                                            >
                                                <Eye size={14} />
                                                <span>Live Monitor</span>
                                            </button>
                                        </>
                                    )}

                                    {isCompleted && (
                                        <button 
                                            className="md-btn md-btn-primary md-btn-sm" 
                                            onClick={() => onSelectExamSummary && onSelectExamSummary(exam._id)}
                                            style={{ width: '100%' }}
                                        >
                                            <BarChart2 size={14} />
                                            <span>View Summary & Analytics</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* End Exam Confirmation Dialog Modal */}
            {endExamModalData && (
                <div className="md-modal-overlay">
                    <div className="md-modal-card" style={{ maxWidth: '440px' }}>
                        <div className="md-modal-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
                            <h3 style={{ color: 'var(--risk-high)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <AlertCircle size={20} /> End Exam Session?
                            </h3>
                            <button className="md-icon-btn" onClick={() => setEndExamModalData(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div style={{ padding: '16px 0', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
                            Are you sure you want to end <strong>"{endExamModalData.title}"</strong>? 
                            <p style={{ marginTop: '8px', color: 'var(--text-primary)', fontWeight: '500' }}>
                                Students will no longer be able to join or submit answers. All active candidate sessions will be finalized into historical archives.
                            </p>
                        </div>
                        <div className="md-modal-actions" style={{ paddingTop: '8px' }}>
                            <button className="md-btn md-btn-text" onClick={() => setEndExamModalData(null)}>
                                Cancel
                            </button>
                            <button 
                                className="md-btn md-btn-danger" 
                                onClick={() => handleUpdateStatus(endExamModalData.id, 'completed')}
                            >
                                Confirm End Exam
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Exam Confirmation Dialog Modal */}
            {deleteExamModalData && (
                <div className="md-modal-overlay">
                    <div className="md-modal-card" style={{ maxWidth: '440px' }}>
                        <div className="md-modal-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
                            <h3 style={{ color: 'var(--risk-high)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Trash2 size={20} /> Delete Exam?
                            </h3>
                            <button className="md-icon-btn" onClick={() => setDeleteExamModalData(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div style={{ padding: '16px 0', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
                            Are you sure you want to delete <strong>"{deleteExamModalData.title}"</strong> ({deleteExamModalData.code})?
                            <p style={{ marginTop: '8px', color: 'var(--risk-high)', fontWeight: '500' }}>
                                This will permanently delete this exam and clean up its question paper. This action cannot be undone.
                            </p>
                        </div>
                        <div className="md-modal-actions" style={{ paddingTop: '8px' }}>
                            <button className="md-btn md-btn-text" onClick={() => setDeleteExamModalData(null)}>
                                Cancel
                            </button>
                            <button 
                                className="md-btn md-btn-danger" 
                                onClick={() => handleDeleteExam(deleteExamModalData.id)}
                            >
                                Confirm Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Exam Modal */}
            {showModal && (
                <div className="md-modal-overlay">
                    <div className="md-modal-card" style={{ maxWidth: '640px' }}>
                        <div className="md-modal-header">
                            <h3>Create New Exam</h3>
                            <button className="md-icon-btn" onClick={() => setShowModal(false)}>
                                <X size={20} />
                            </button>
                        </div>

                        {formError && (
                            <div className="md-alert md-alert-error" style={{ marginBottom: '16px' }}>
                                <AlertCircle size={16} />
                                <span>{formError}</span>
                            </div>
                        )}

                        <form onSubmit={handleCreateExam}>
                            <div className="md-form-group">
                                <label>Exam Title *</label>
                                <input 
                                    type="text" 
                                    className="md-input" 
                                    placeholder="e.g. Computer Science CS101 Midterm Exam" 
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    required 
                                />
                            </div>

                            <div className="md-form-group">
                                <label>Custom Exam Code (Optional)</label>
                                <input 
                                    type="text" 
                                    className="md-input" 
                                    placeholder="e.g. CS101-A (leave empty to auto-generate)" 
                                    value={customCode}
                                    onChange={(e) => setCustomCode(e.target.value)}
                                />
                                <span className="md-help-text">Students enter this code on their app to join.</span>
                            </div>

                            <div className="md-form-group">
                                <label>Initial Status</label>
                                <select 
                                    className="md-select" 
                                    value={status} 
                                    onChange={(e) => setStatus(e.target.value)}
                                >
                                    <option value="active">Active (Ready for Candidates)</option>
                                    <option value="draft">Draft (Saved for later)</option>
                                </select>
                            </div>

                            <div className="md-form-group">
                                <label>Exam Duration (Minutes)</label>
                                <select 
                                    className="md-select" 
                                    value={durationMinutes} 
                                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                                >
                                    <option value={30}>30 Minutes</option>
                                    <option value={60}>60 Minutes (1 Hour)</option>
                                    <option value={90}>90 Minutes (1.5 Hours)</option>
                                    <option value={120}>120 Minutes (2 Hours)</option>
                                    <option value={0}>Untimed / Unlimited</option>
                                </select>
                            </div>

                            {/* Proctoring Rules Configuration */}
                            <div style={{ background: '#f8f9fa', border: '1px solid #dadce0', borderRadius: '8px', padding: '14px', marginBottom: '16px' }}>
                                <div style={{ fontWeight: 600, fontSize: '14px', color: '#202124', marginBottom: '10px' }}>
                                    ⚙️ Proctoring Rules & AI Strictness Settings
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#3c4043' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={detectCellPhone} 
                                            onChange={(e) => setDetectCellPhone(e.target.checked)} 
                                        />
                                        <span>📱 Mobile Phone AI Detection</span>
                                    </label>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#3c4043' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={detectMultiplePersons} 
                                            onChange={(e) => setDetectMultiplePersons(e.target.checked)} 
                                        />
                                        <span>👥 Multiple Persons Detection</span>
                                    </label>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#3c4043' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={enforceAppWhitelist} 
                                            onChange={(e) => setEnforceAppWhitelist(e.target.checked)} 
                                        />
                                        <span>🖥️ App Whitelist Enforcement</span>
                                    </label>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#3c4043' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={detectLookingAway} 
                                            onChange={(e) => setDetectLookingAway(e.target.checked)} 
                                        />
                                        <span>👀 Gaze / Looking Away Alerts</span>
                                    </label>
                                </div>

                                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #e8eaed' }}>
                                    <label style={{ fontSize: '13px', fontWeight: 500, color: '#202124', display: 'block', marginBottom: '4px' }}>
                                        ⚠️ High-Risk Alert Threshold for Teacher Review
                                    </label>
                                    <select 
                                        className="md-select" 
                                        value={autoTerminateRiskScore} 
                                        onChange={(e) => setAutoTerminateRiskScore(Number(e.target.value))}
                                        style={{ fontSize: '13px', padding: '6px 10px' }}
                                    >
                                        <option value={60}>High Sensitivity (Alert Teacher at Risk Score &ge; 60)</option>
                                        <option value={75}>Standard Sensitivity (Alert Teacher at Risk Score &ge; 75 - Default)</option>
                                        <option value={90}>Low Sensitivity (Alert Teacher at Risk Score &ge; 90)</option>
                                        <option value={0}>Standard Alerts Only</option>
                                    </select>
                                    <span className="md-help-text" style={{ fontSize: '11px', color: '#5f6368', marginTop: '2px', display: 'block' }}>
                                        Highlights candidate in student roster for immediate teacher review & manual action.
                                    </span>
                                </div>
                            </div>

                            {/* Allowed Software & Tools Configuration */}
                            <div style={{ background: '#f8f9fa', border: '1px solid #dadce0', borderRadius: '8px', padding: '14px', marginBottom: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#202124' }}>
                                        💻 Permitted Software & Coding Tools (Optional)
                                    </div>
                                    <span style={{ fontSize: '12px', fontWeight: 600, color: allowedApps.length > 0 ? '#188038' : '#5f6368' }}>
                                        {allowedApps.length > 0 ? `${allowedApps.length} Permitted` : 'Full Lockdown (Default)'}
                                    </span>
                                </div>
                                <p style={{ fontSize: '12px', color: '#5f6368', margin: '0 0 10px 0' }}>
                                    Select tools required for this exam (e.g. C++ programming, essays, math). Students running these selected applications will not be blocked.
                                </p>

                                {/* Preset Tiles */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                                    {SOFTWARE_PRESETS.map((preset) => {
                                        const isSelected = allowedApps.some(a => a.executable.toLowerCase() === preset.executable.toLowerCase());
                                        return (
                                            <div
                                                key={preset.id}
                                                onClick={() => togglePresetApp(preset)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    padding: '8px 10px',
                                                    borderRadius: '6px',
                                                    border: isSelected ? '1.5px solid #1a73e8' : '1px solid #dadce0',
                                                    background: isSelected ? '#e8f0fe' : '#ffffff',
                                                    cursor: 'pointer',
                                                    userSelect: 'none',
                                                    transition: 'all 0.15s ease'
                                                }}
                                            >
                                                <span style={{ fontSize: '16px' }}>{preset.icon}</span>
                                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                                    <div style={{ fontSize: '12px', fontWeight: isSelected ? 600 : 500, color: isSelected ? '#1a73e8' : '#202124', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                                        {preset.name}
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: isSelected ? '#185abc' : '#80868b' }}>
                                                        {preset.executable}
                                                    </div>
                                                </div>
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected} 
                                                    onChange={() => {}} 
                                                    style={{ cursor: 'pointer', accentColor: '#1a73e8' }} 
                                                />
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Custom Executable Adder */}
                                <div style={{ paddingTop: '10px', borderTop: '1px solid #e8eaed' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 500, color: '#3c4043', marginBottom: '6px' }}>
                                        ➕ Add Custom Application / Tool
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input 
                                            type="text" 
                                            className="md-input" 
                                            placeholder="Software Name (e.g. Packet Tracer)"
                                            value={customAppName}
                                            onChange={(e) => setCustomAppName(e.target.value)}
                                            style={{ fontSize: '12px', padding: '6px 10px' }}
                                        />
                                        <input 
                                            type="text" 
                                            className="md-input" 
                                            placeholder="Executable (e.g. packettracer.exe)"
                                            value={customAppExe}
                                            onChange={(e) => setCustomAppExe(e.target.value)}
                                            style={{ fontSize: '12px', padding: '6px 10px' }}
                                        />
                                        <button 
                                            type="button" 
                                            className="md-btn md-btn-outlined md-btn-sm" 
                                            onClick={handleAddCustomApp}
                                            style={{ whiteSpace: 'nowrap' }}
                                        >
                                            Add Tool
                                        </button>
                                    </div>

                                    {/* Custom Apps Added Display */}
                                    {allowedApps.filter(a => !SOFTWARE_PRESETS.some(p => p.executable.toLowerCase() === a.executable.toLowerCase())).length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                                            {allowedApps
                                                .filter(a => !SOFTWARE_PRESETS.some(p => p.executable.toLowerCase() === a.executable.toLowerCase()))
                                                .map(app => (
                                                    <span 
                                                        key={app.executable} 
                                                        className="md-badge" 
                                                        style={{ background: '#e8f0fe', color: '#1a73e8', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px' }}
                                                    >
                                                        <span>{app.name} ({app.executable})</span>
                                                        <X 
                                                            size={12} 
                                                            style={{ cursor: 'pointer' }} 
                                                            onClick={() => handleRemoveAllowedApp(app.executable)} 
                                                        />
                                                    </span>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="md-form-group">
                                <label>Upload Question Paper (PDF / DOCX)</label>
                                <input 
                                    type="file" 
                                    className="md-file-input" 
                                    accept=".pdf,.docx,.doc" 
                                    onChange={(e) => setPaperFile(e.target.files[0] || null)}
                                />
                            </div>

                            <div className="md-modal-actions">
                                <button type="button" className="md-btn md-btn-text" onClick={() => setShowModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="md-btn md-btn-primary" disabled={submitting}>
                                    {submitting ? 'Creating...' : 'Create Exam'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
