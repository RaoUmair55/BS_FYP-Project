import React from 'react';
import { Shield, Users, FileText, AlertTriangle, Cloud, CheckCircle, Database, TrendingUp, Layers } from 'lucide-react';

const VIOLATION_COLORS = {
    head_turn_away: '#1a73e8',
    second_person_detected: '#d93025',
    no_face_detected: '#9334e6',
    unauthorized_object: '#e37400',
    unauthorized_app: '#00acc1',
    cell_phone: '#c5221f',
    camera_issue: '#5f6368',
    camera_occluded_or_dark: '#7627bb',
    usb_device_detected: '#f9ab00',
    multiple_displays_detected: '#185abc',
    second_voice_detected: '#34a853',
    pre_existing_file: '#64748b'
};

const LEGACY_VIOLATION_COLORS = [
    '#1a73e8', // Google Blue
    '#ea4335', // Google Red
    '#f9ab00', // Google Amber
    '#34a853', // Google Green
    '#9334e6', // Google Purple
    '#00acc1', // Google Cyan
    '#e37400', // Google Orange
    '#5f6368'  // Google Gray
];

export default function AnalyticsView({ stats, loading }) {
    if (loading || !stats) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div className="auth-spinner" style={{ margin: '0 auto 16px auto' }}></div>
                <span>Loading Analytics & Metrics...</span>
            </div>
        );
    }

    const { overview = {}, storage = {}, violationBreakdown = [], severityBreakdown = [], activityTimeline = [] } = stats;

    const totalViolations = overview.totalViolations || 0;
    const reviewedViolations = (overview.confirmedViolations || 0) + (overview.dismissedViolations || 0);
    const reviewRate = totalViolations > 0 ? Math.round((reviewedViolations / totalViolations) * 100) : 100;

    // Prepare SVG Donut Chart Slices
    const donutRadius = 65;
    const circumference = 2 * Math.PI * donutRadius;
    let cumulativePercent = 0;

    const donutSlices = violationBreakdown.map((item, index) => {
        const percent = totalViolations > 0 ? (item.count / totalViolations) : 0;
        const strokeDasharray = `${percent * circumference} ${circumference}`;
        const strokeDashoffset = -cumulativePercent * circumference;
        cumulativePercent += percent;
        const color = VIOLATION_COLORS[item.type] || LEGACY_VIOLATION_COLORS[index % LEGACY_VIOLATION_COLORS.length];

        return {
            ...item,
            percent: Math.round(percent * 100),
            color,
            strokeDasharray,
            strokeDashoffset
        };
    });

    // Storage Category Percentages
    const totalStorageAssets = storage.totalAssets || 1;
    const papersPct = Math.round(((storage.papersCount || 0) / totalStorageAssets) * 100);
    const verifyPct = Math.round(((storage.verificationCount || 0) / totalStorageAssets) * 100);
    const screenPct = Math.round(((storage.screenshotsCount || 0) / totalStorageAssets) * 100);
    const subPct = Math.round(((storage.submissionsCount || 0) / totalStorageAssets) * 100);

    // Max activity count for bar scaling
    const maxActivity = Math.max(...activityTimeline.map(t => t.count), 1);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Top KPI Cards */}
            <div className="admin-kpi-grid">
                <div className="admin-kpi-card">
                    <div className="admin-kpi-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
                        <Layers size={22} />
                    </div>
                    <div>
                        <div className="admin-kpi-value">{overview.totalExams || 0}</div>
                        <div className="admin-kpi-label">Total Exams ({overview.activeExams || 0} Active)</div>
                    </div>
                </div>

                <div className="admin-kpi-card">
                    <div className="admin-kpi-icon" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                        <Users size={22} />
                    </div>
                    <div>
                        <div className="admin-kpi-value">{overview.totalSessions || 0}</div>
                        <div className="admin-kpi-label">Candidate Sessions</div>
                    </div>
                </div>

                <div className="admin-kpi-card">
                    <div className="admin-kpi-icon" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                        <AlertTriangle size={22} />
                    </div>
                    <div>
                        <div className="admin-kpi-value">{totalViolations}</div>
                        <div className="admin-kpi-label">Violations Detected ({reviewRate}% Reviewed)</div>
                    </div>
                </div>

                <div className="admin-kpi-card">
                    <div className="admin-kpi-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                        <Shield size={22} />
                    </div>
                    <div>
                        <div className="admin-kpi-value">{overview.terminatedSessions || 0}</div>
                        <div className="admin-kpi-label">Terminated Sessions</div>
                    </div>
                </div>

                <div className="admin-kpi-card">
                    <div className="admin-kpi-icon" style={{ background: '#f3e8fd', color: '#7627bb' }}>
                        <Cloud size={22} />
                    </div>
                    <div>
                        <div className="admin-kpi-value">{storage.totalAssets || 0}</div>
                        <div className="admin-kpi-label">Media Files ({storage.provider})</div>
                    </div>
                </div>
            </div>

            {/* Charts Grid: Violation Breakdown & Storage Meter */}
            <div className="admin-charts-grid">
                
                {/* 1. Violation Distribution Donut Chart */}
                <div className="admin-card">
                    <div className="admin-card-header">
                        <h3 className="admin-card-title">
                            <AlertTriangle size={18} color="var(--primary)" />
                            Violation Distribution by Type
                        </h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total: {totalViolations}</span>
                    </div>

                    {totalViolations === 0 ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                            <CheckCircle size={32} color="var(--success)" style={{ marginBottom: '8px' }} />
                            <div>No violations logged in the system yet.</div>
                        </div>
                    ) : (
                        <div className="donut-chart-wrapper">
                            <svg width="180" height="180" viewBox="0 0 180 180" style={{ transform: 'rotate(-90deg)' }}>
                                <circle
                                    cx="90"
                                    cy="90"
                                    r={donutRadius}
                                    fill="transparent"
                                    stroke="#f1f3f4"
                                    strokeWidth="24"
                                />
                                {donutSlices.map((slice, i) => (
                                    <circle
                                        key={i}
                                        cx="90"
                                        cy="90"
                                        r={donutRadius}
                                        fill="transparent"
                                        stroke={slice.color}
                                        strokeWidth="24"
                                        strokeDasharray={slice.strokeDasharray}
                                        strokeDashoffset={slice.strokeDashoffset}
                                        strokeLinecap="round"
                                        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                                    />
                                ))}
                            </svg>

                            <div className="chart-legend">
                                {donutSlices.map((slice, i) => (
                                    <div key={i} className="legend-item">
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <span className="legend-color-box" style={{ background: slice.color }}></span>
                                            <span style={{ maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {slice.type.replace(/_/g, ' ')}
                                            </span>
                                        </div>
                                        <span style={{ fontWeight: 600 }}>{slice.count} ({slice.percent}%)</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* 2. Storage distribution */}
                <div className="admin-card">
                    <div className="admin-card-header">
                        <h3 className="admin-card-title">
                            <Database size={18} color="var(--primary)" />
                            Storage by Asset Type
                        </h3>
                        <span className="admin-chip chip-paper" style={{ textTransform: 'none' }}>
                            {storage.provider}
                        </span>
                    </div>

                    <div className="storage-meter-container">
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                            <span>Total Stored Assets: <strong>{storage.totalAssets || 0}</strong></span>
                            <span>Provider: <strong>{storage.provider || 'Not configured'}</strong></span>
                        </div>

                        {/* Multi-segment Progress Bar */}
                        <div className="storage-bar-wrapper">
                            <div className="storage-segment" style={{ width: `${papersPct}%`, background: 'var(--primary-bg)' }} title={`Exam Papers: ${storage.papersCount || 0}`}></div>
                            <div className="storage-segment" style={{ width: `${verifyPct}%`, background: 'var(--success-bg)' }} title={`Verification Photos: ${storage.verificationCount || 0}`}></div>
                            <div className="storage-segment" style={{ width: `${screenPct}%`, background: 'var(--warning-bg)' }} title={`Violation Screenshots: ${storage.screenshotsCount || 0}`}></div>
                            <div className="storage-segment" style={{ width: `${subPct}%`, background: '#9334e6' }} title={`Submissions: ${storage.submissionsCount || 0}`}></div>
                        </div>

                        {/* Category Stats Grid */}
                        <div className="storage-stats-chips">
                            <div className="storage-chip">
                                <FileText size={18} color="var(--primary)" />
                                <div>
                                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{storage.papersCount || 0}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Exam Papers</div>
                                </div>
                            </div>

                            <div className="storage-chip">
                                <Users size={18} color="var(--success)" />
                                <div>
                                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{storage.verificationCount || 0}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Verification Photos</div>
                                </div>
                            </div>

                            <div className="storage-chip">
                                <AlertTriangle size={18} color="var(--warning)" />
                                <div>
                                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{storage.screenshotsCount || 0}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Screenshots</div>
                                </div>
                            </div>

                            <div className="storage-chip">
                                <Shield size={18} color="#9334e6" />
                                <div>
                                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{storage.submissionsCount || 0}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Submissions</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Chart: Activity Timeline */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h3 className="admin-card-title">
                        <TrendingUp size={18} color="var(--primary)" />
                        14-Day Violation Activity Trend
                    </h3>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Daily incident occurrences</span>
                </div>

                {activityTimeline.length === 0 ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                        No daily activity recorded in the last 14 days.
                    </div>
                ) : (
                    <div>
                        <div className="trend-bars-container">
                            {activityTimeline.map((item, idx) => {
                                const heightPercent = Math.max(8, Math.round((item.count / maxActivity) * 100));
                                return (
                                    <div key={idx} className="trend-bar-column">
                                        <div 
                                            className="trend-bar" 
                                            style={{ height: `${heightPercent}%` }}
                                            title={`${item._id}: ${item.count} violations`}
                                        ></div>
                                        <span className="trend-bar-label">
                                            {item._id.substring(5)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
