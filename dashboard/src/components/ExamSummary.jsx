import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
    ArrowLeft, Users, AlertTriangle, Activity, CheckCircle, 
    XCircle, Clock, FileText, ExternalLink, RefreshCw,
    Download, Printer, PieChart, BarChart2, Shield
} from 'lucide-react';
import RiskScoreBadge from './RiskScoreBadge';
import EvidenceViewer from './EvidenceViewer';

const API_BASE = 'http://localhost:5000';

function formatType(typeStr) {
    if (!typeStr) return "Unknown";
    return typeStr.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const ExamSummary = ({ examId, onBack }) => {
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedStudentSessionId, setSelectedStudentSessionId] = useState(null);

    const fetchSummary = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await axios.get(`${API_BASE}/exams/${examId}/summary`);
            setSummary(res.data);
        } catch (err) {
            console.error('Failed to fetch exam summary:', err);
            setError(err.response?.data?.error || 'Failed to load exam summary');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (examId) {
            fetchSummary();
        }
    }, [examId]);

    const handleExportCSV = () => {
        if (!summary || !summary.sessions) return;
        const examCode = summary.exam?.examCode || 'EXAM';
        const headers = ["Candidate ID", "Exam Code", "Start Time", "End Time", "Violations Count", "Risk Score", "Risk Category", "Submission Status", "Submission Type"];
        
        const rows = summary.sessions.map(s => {
            const riskCategory = s.finalRiskScore >= 60 ? "High Risk" : s.finalRiskScore >= 30 ? "Moderate Risk" : "Low Risk";
            return [
                `"${s.studentId || ''}"`,
                `"${s.examId || examCode}"`,
                `"${new Date(s.startTime).toLocaleString()}"`,
                `"${s.endTime ? new Date(s.endTime).toLocaleString() : 'N/A'}"`,
                s.violationCount,
                s.finalRiskScore,
                `"${riskCategory}"`,
                `"${s.submissionStatus || (s.submitted ? 'Submitted' : 'Not Submitted')}"`,
                `"${s.submissionType || 'N/A'}"`
            ].join(',');
        });

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `IntegrityFlow_Proctoring_Report_${examCode}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handlePrintPDF = () => {
        window.print();
    };

    const getRiskColorClass = (score) => {
        if (score >= 60) return 'risk-high-stat';
        if (score >= 30) return 'risk-med-stat';
        return 'risk-low-stat';
    };

    if (loading) {
        return (
            <div className="exam-summary-container" style={{ padding: '32px', textAlign: 'center' }}>
                <RefreshCw size={28} className="spin" style={{ color: 'var(--brand-primary)' }} />
                <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Loading exam summary & analytics...</p>
            </div>
        );
    }

    if (error || !summary) {
        return (
            <div className="exam-summary-container" style={{ padding: '24px' }}>
                <button className="sub-tab-btn" onClick={onBack} style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ArrowLeft size={16} /> Back
                </button>
                <div style={{ background: '#FCE8E6', color: '#D93025', padding: '16px', borderRadius: '8px' }}>
                    {error || 'Summary data unavailable'}
                </div>
            </div>
        );
    }

    const { exam, totalStudents, totalViolations, avgRiskScore, sessions } = summary;

    // Risk distribution calculation
    const riskDist = summary.riskDistribution || {
        high: sessions.filter(s => s.finalRiskScore >= 60).length,
        moderate: sessions.filter(s => s.finalRiskScore >= 30 && s.finalRiskScore < 60).length,
        low: sessions.filter(s => s.finalRiskScore < 30).length
    };

    const highPct = totalStudents > 0 ? Math.round((riskDist.high / totalStudents) * 100) : 0;
    const modPct = totalStudents > 0 ? Math.round((riskDist.moderate / totalStudents) * 100) : 0;
    const lowPct = totalStudents > 0 ? Math.round((riskDist.low / totalStudents) * 100) : 0;

    // Violation breakdown
    const violationMap = summary.violationBreakdown || {};
    const violationEntries = Object.entries(violationMap).sort((a, b) => b[1] - a[1]);
    const maxViolationCount = Math.max(...Object.values(violationMap), 1);

    return (
        <div className="exam-summary-container">
            {/* Summary Top Header Bar */}
            <div className="summary-header">
                <button className="back-btn-material no-print" onClick={onBack}>
                    <ArrowLeft size={18} />
                    <span>Back to Exams</span>
                </button>
                
                <div className="summary-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', width: '100%' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <h1 className="summary-title">{exam.title || 'Completed Exam'}</h1>
                            <span className="exam-code-chip">{exam.examCode}</span>
                            <span className="status-chip completed">COMPLETED</span>
                        </div>
                        <p className="summary-subtitle">
                            Integrity Audit Report &bull; Created on {new Date(exam.createdAt).toLocaleDateString()} &bull; {totalStudents} Participants
                        </p>
                    </div>

                    {/* Export Action Controls */}
                    <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button 
                            className="md-btn md-btn-outlined md-btn-sm"
                            onClick={handleExportCSV}
                            title="Export student roster & risk scores as CSV spreadsheet"
                        >
                            <Download size={14} />
                            <span>Export CSV</span>
                        </button>
                        <button 
                            className="md-btn md-btn-primary md-btn-sm"
                            onClick={handlePrintPDF}
                            title="Open print dialog to save formal PDF audit report"
                        >
                            <Printer size={14} />
                            <span>Save PDF Report</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Aggregated Stat Cards Grid */}
            <div className="summary-stats-grid">
                <div className="summary-stat-card">
                    <div className="stat-icon-wrapper blue">
                        <Users size={22} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Total Candidates</span>
                        <span className="stat-value">{totalStudents}</span>
                    </div>
                </div>

                <div className="summary-stat-card">
                    <div className="stat-icon-wrapper amber">
                        <AlertTriangle size={22} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Total Violations</span>
                        <span className="stat-value">{totalViolations}</span>
                    </div>
                </div>

                <div className={`summary-stat-card ${getRiskColorClass(avgRiskScore)}`}>
                    <div className="stat-icon-wrapper">
                        <Activity size={22} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Average Risk Score</span>
                        <span className="stat-value">{avgRiskScore} / 100</span>
                    </div>
                </div>
            </div>

            {/* Interactive Analytics Section: Risk Distribution & Violation Type Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                
                {/* Card 1: Risk Score Distribution */}
                <div className="md-card" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <PieChart size={18} style={{ color: '#1a73e8' }} />
                        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#202124' }}>
                            Candidate Risk Distribution
                        </h3>
                    </div>

                    {/* Segmented Progress Bar */}
                    <div style={{ height: '14px', borderRadius: '7px', background: '#e8eaed', overflow: 'hidden', display: 'flex', marginBottom: '16px' }}>
                        {highPct > 0 && <div style={{ width: `${highPct}%`, background: '#d93025' }} title={`High Risk: ${riskDist.high}`} />}
                        {modPct > 0 && <div style={{ width: `${modPct}%`, background: '#f9ab00' }} title={`Moderate Risk: ${riskDist.moderate}`} />}
                        {lowPct > 0 && <div style={{ width: `${lowPct}%`, background: '#188038' }} title={`Low Risk: ${riskDist.low}`} />}
                    </div>

                    {/* Stat Breakdown Pills */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#202124' }}>
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#d93025', display: 'inline-block' }}></span>
                                High Risk (&gt;=60)
                            </span>
                            <span style={{ fontWeight: 600, color: '#d93025' }}>{riskDist.high} ({highPct}%)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#202124' }}>
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f9ab00', display: 'inline-block' }}></span>
                                Moderate Risk (30-59)
                            </span>
                            <span style={{ fontWeight: 600, color: '#b06000' }}>{riskDist.moderate} ({modPct}%)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#202124' }}>
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#188038', display: 'inline-block' }}></span>
                                Low Risk (&lt;30)
                            </span>
                            <span style={{ fontWeight: 600, color: '#188038' }}>{riskDist.low} ({lowPct}%)</span>
                        </div>
                    </div>
                </div>

                {/* Card 2: Violation Type Breakdown Bar Chart */}
                <div className="md-card" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <BarChart2 size={18} style={{ color: '#1a73e8' }} />
                        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#202124' }}>
                            Top Violation Categories
                        </h3>
                    </div>

                    {violationEntries.length === 0 ? (
                        <div style={{ padding: '24px 0', textAlign: 'center', color: '#5f6368', fontSize: '13px' }}>
                            No violations recorded across candidates.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {violationEntries.map(([typeKey, count]) => {
                                const pct = Math.round((count / maxViolationCount) * 100);
                                return (
                                    <div key={typeKey}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
                                            <span style={{ fontWeight: 500, color: '#3c4043' }}>{formatType(typeKey)}</span>
                                            <span style={{ fontWeight: 600, color: '#1a73e8' }}>{count} alerts</span>
                                        </div>
                                        <div style={{ height: '8px', borderRadius: '4px', background: '#f1f3f4', overflow: 'hidden' }}>
                                            <div style={{ width: `${pct}%`, height: '100%', background: '#1a73e8', borderRadius: '4px', transition: 'width 0.3s ease' }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Candidate Session Roster Table */}
            <div className="summary-table-card">
                <div className="summary-table-header">
                    <h3>Candidate Performance & Integrity Roster</h3>
                    <span className="count-pill">{sessions.length} Candidates</span>
                </div>

                {sessions.length === 0 ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No candidates participated in this exam session.
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="summary-table">
                            <thead>
                                <tr>
                                    <th>Candidate ID</th>
                                    <th>Started At</th>
                                    <th>Violations</th>
                                    <th>Risk Score</th>
                                    <th>Submission Status</th>
                                    <th className="no-print" style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((s) => (
                                    <tr key={s.sessionId} className="summary-table-row">
                                        <td className="student-id-cell">
                                            <span className="student-id-text">{s.studentId}</span>
                                        </td>
                                        <td className="time-cell">
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                                                <Clock size={13} />
                                                {new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`violation-count-badge ${s.violationCount > 0 ? 'has-violations' : ''}`}>
                                                {s.violationCount} alerts
                                            </span>
                                        </td>
                                        <td>
                                            <RiskScoreBadge score={s.finalRiskScore} />
                                        </td>
                                        <td>
                                            {s.submitted ? (
                                                <span className="submission-badge submitted">
                                                    <CheckCircle size={13} />
                                                    Submitted ({s.submissionType || 'File'})
                                                </span>
                                            ) : (
                                                <span className="submission-badge unsubmitted">
                                                    <XCircle size={13} />
                                                    Not Submitted
                                                </span>
                                            )}
                                        </td>
                                        <td className="no-print" style={{ textAlign: 'right' }}>
                                            <button 
                                                className="evidence-action-btn"
                                                onClick={() => setSelectedStudentSessionId(s.sessionId)}
                                                title="Review candidate screenshot & violation evidence"
                                            >
                                                <ExternalLink size={14} />
                                                <span>Review Evidence</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Evidence Modal overlay when clicking a student row */}
            {selectedStudentSessionId && (
                <div className="modal-backdrop no-print">
                    <div className="modal-dialog large-modal">
                        <div className="modal-header">
                            <h3>Candidate Evidence Review</h3>
                            <button 
                                className="modal-close-btn" 
                                onClick={() => setSelectedStudentSessionId(null)}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="modal-body" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                            <EvidenceViewer sessionId={selectedStudentSessionId} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExamSummary;
