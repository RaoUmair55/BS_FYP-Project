import React, { useState } from 'react';
import { 
    Shield, Users, FileText, AlertTriangle, Cloud, CheckCircle, Database, 
    TrendingUp, Layers, X, Download, ExternalLink, Search, Eye, Maximize2, 
    ArrowRight, Clock, User, Hash, FileCode, Check, Copy, FolderKanban
} from 'lucide-react';
import { assetUrl } from '../../services/api';

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

export default function AnalyticsView({ stats, loading, assets = [], onPreview, onSwitchToAssets }) {
    const [selectedCategory, setSelectedCategory] = useState(null); // 'submission' | 'verification' | 'screenshot' | 'paper' | null
    const [searchQuery, setSearchQuery] = useState('');
    const [zoomImageSrc, setZoomImageSrc] = useState(null);
    const [copiedId, setCopiedId] = useState(null);

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

    // Filtered Category Items for Overlay Modal
    const categoryItems = (assets || []).filter(item => {
        if (!selectedCategory) return false;
        if (item.assetType !== selectedCategory) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchTitle = (item.title || '').toLowerCase().includes(q);
            const matchFilename = (item.filename || '').toLowerCase().includes(q);
            const matchCandidate = (item.candidateName || '').toLowerCase().includes(q);
            const matchRoll = (item.rollNumber || '').toLowerCase().includes(q);
            const matchExam = (item.examId || '').toLowerCase().includes(q);
            return matchTitle || matchFilename || matchCandidate || matchRoll || matchExam;
        }
        return true;
    });

    const getCategoryConfig = (cat) => {
        switch (cat) {
            case 'submission':
                return { title: 'Candidate Submissions', icon: <Shield size={20} color="#9334e6" />, color: '#9334e6', bgSoft: 'rgba(147, 51, 234, 0.1)' };
            case 'verification':
                return { title: 'Verification Photos', icon: <Users size={20} color="var(--success)" />, color: 'var(--success)', bgSoft: 'var(--success-soft)' };
            case 'screenshot':
                return { title: 'Violation Screenshots', icon: <AlertTriangle size={20} color="var(--warning)" />, color: 'var(--warning)', bgSoft: 'var(--warning-soft)' };
            case 'paper':
                return { title: 'Exam Question Papers', icon: <FileText size={20} color="var(--primary)" />, color: 'var(--primary)', bgSoft: 'var(--primary-soft)' };
            default:
                return { title: 'Stored Assets', icon: <Database size={20} color="var(--primary)" />, color: 'var(--primary)', bgSoft: 'var(--primary-soft)' };
        }
    };

    const handleCopyLink = (url, id) => {
        if (!url) return;
        navigator.clipboard.writeText(url);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleDownload = async (item) => {
        if (!item.url) return;
        try {
            const targetUrl = assetUrl(item.url);
            const token = localStorage.getItem('token');
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(targetUrl, { headers });
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = item.filename || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
        } catch (err) {
            console.error('Error downloading asset:', err);
            const link = document.createElement('a');
            link.href = assetUrl(item.url);
            link.target = '_blank';
            link.download = item.filename || 'download';
            link.click();
        }
    };

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

                        {/* Interactive Category Stats Grid */}
                        <div className="storage-stats-chips">
                            <div 
                                className="storage-chip clickable"
                                onClick={() => { setSelectedCategory('paper'); setSearchQuery(''); }}
                                title="Click to view all Exam Papers"
                            >
                                <FileText size={18} color="var(--primary)" />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{storage.papersCount || 0}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Exam Papers</div>
                                </div>
                                <span style={{ fontSize: '10.5px', color: 'var(--primary)', fontWeight: 600, opacity: 0.85 }}>View &rarr;</span>
                            </div>

                            <div 
                                className="storage-chip clickable"
                                onClick={() => { setSelectedCategory('verification'); setSearchQuery(''); }}
                                title="Click to view all Verification Photos"
                            >
                                <Users size={18} color="var(--success)" />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{storage.verificationCount || 0}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Verification Photos</div>
                                </div>
                                <span style={{ fontSize: '10.5px', color: 'var(--success)', fontWeight: 600, opacity: 0.85 }}>View &rarr;</span>
                            </div>

                            <div 
                                className="storage-chip clickable"
                                onClick={() => { setSelectedCategory('screenshot'); setSearchQuery(''); }}
                                title="Click to view all Screenshots"
                            >
                                <AlertTriangle size={18} color="var(--warning)" />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{storage.screenshotsCount || 0}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Screenshots</div>
                                </div>
                                <span style={{ fontSize: '10.5px', color: 'var(--warning)', fontWeight: 600, opacity: 0.85 }}>View &rarr;</span>
                            </div>

                            <div 
                                className="storage-chip clickable"
                                onClick={() => { setSelectedCategory('submission'); setSearchQuery(''); }}
                                title="Click to view all Submissions"
                            >
                                <Shield size={18} color="#9334e6" />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{storage.submissionsCount || 0}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Submissions</div>
                                </div>
                                <span style={{ fontSize: '10.5px', color: '#9334e6', fontWeight: 600, opacity: 0.85 }}>View &rarr;</span>
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

            {/* Interactive Category Assets Overlay Modal */}
            {selectedCategory && (
                <div className="lightbox-overlay" onClick={() => setSelectedCategory(null)} style={{ zIndex: 1050 }}>
                    <div 
                        className="modal-dialog" 
                        onClick={(e) => e.stopPropagation()}
                        style={{ 
                            maxWidth: '900px', 
                            width: '94%', 
                            maxHeight: '88vh', 
                            display: 'flex', 
                            flexDirection: 'column',
                            borderRadius: '12px',
                            overflow: 'hidden',
                            boxShadow: '0 20px 45px rgba(0, 0, 0, 0.4)'
                        }}
                    >
                        {/* Overlay Header */}
                        <div 
                            style={{ 
                                padding: '16px 20px', 
                                borderBottom: '1px solid var(--border-color)', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                background: 'var(--bg-surface)'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '8px',
                                    background: getCategoryConfig(selectedCategory).bgSoft,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    {getCategoryConfig(selectedCategory).icon}
                                </div>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-main)' }}>
                                            {getCategoryConfig(selectedCategory).title}
                                        </h3>
                                        <span className="md-badge" style={{ fontSize: '11.5px', background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>
                                            {categoryItems.length} Total
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                        Instant inspection and download of stored {selectedCategory} files
                                    </div>
                                </div>
                            </div>

                            <button 
                                className="asset-icon-btn" 
                                onClick={() => setSelectedCategory(null)}
                                style={{ borderRadius: '50%', width: '32px', height: '32px' }}
                                title="Close dialog"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Category Switcher Tabs & Search Toolbar */}
                        <div style={{
                            padding: '12px 20px',
                            background: 'var(--bg-base)',
                            borderBottom: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '12px'
                        }}>
                            {/* Category Switcher Pills */}
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                    type="button"
                                    className={`md-btn md-btn-sm ${selectedCategory === 'submission' ? 'md-btn-primary' : 'md-btn-outlined'}`}
                                    style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '20px' }}
                                    onClick={() => setSelectedCategory('submission')}
                                >
                                    <Shield size={13} />
                                    <span>Submissions ({storage.submissionsCount || 0})</span>
                                </button>
                                <button
                                    type="button"
                                    className={`md-btn md-btn-sm ${selectedCategory === 'screenshot' ? 'md-btn-primary' : 'md-btn-outlined'}`}
                                    style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '20px' }}
                                    onClick={() => setSelectedCategory('screenshot')}
                                >
                                    <AlertTriangle size={13} />
                                    <span>Screenshots ({storage.screenshotsCount || 0})</span>
                                </button>
                                <button
                                    type="button"
                                    className={`md-btn md-btn-sm ${selectedCategory === 'verification' ? 'md-btn-primary' : 'md-btn-outlined'}`}
                                    style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '20px' }}
                                    onClick={() => setSelectedCategory('verification')}
                                >
                                    <Users size={13} />
                                    <span>Verification ({storage.verificationCount || 0})</span>
                                </button>
                                <button
                                    type="button"
                                    className={`md-btn md-btn-sm ${selectedCategory === 'paper' ? 'md-btn-primary' : 'md-btn-outlined'}`}
                                    style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '20px' }}
                                    onClick={() => setSelectedCategory('paper')}
                                >
                                    <FileText size={13} />
                                    <span>Papers ({storage.papersCount || 0})</span>
                                </button>
                            </div>

                            {/* Search Input */}
                            <div style={{ position: 'relative', minWidth: '220px' }}>
                                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                                <input 
                                    type="text"
                                    placeholder="Search candidate, exam, file..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{
                                        padding: '5px 10px 5px 30px',
                                        fontSize: '12.5px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-color)',
                                        background: 'var(--bg-surface)',
                                        color: 'var(--text-main)',
                                        width: '100%',
                                        outline: 'none'
                                    }}
                                />
                                {searchQuery && (
                                    <button 
                                        onClick={() => setSearchQuery('')}
                                        style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Overlay Body: Asset Cards Grid / List */}
                        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, maxHeight: 'calc(88vh - 180px)' }}>
                            {categoryItems.length === 0 ? (
                                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                    <FolderKanban size={44} style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
                                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>
                                        No {getCategoryConfig(selectedCategory).title} Found
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                        {searchQuery ? 'Try adjusting your search keywords.' : `There are no stored ${selectedCategory} assets uploaded to the system yet.`}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                                    {categoryItems.map((item, idx) => {
                                        const isImage = item.assetType === 'verification' || item.assetType === 'screenshot' || (item.url && item.url.match(/\.(jpg|jpeg|png|webp)/i));
                                        
                                        return (
                                            <div 
                                                key={item.id || idx}
                                                style={{
                                                    background: 'var(--bg-surface)',
                                                    border: '1px solid var(--border-color)',
                                                    borderRadius: '8px',
                                                    padding: '12px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    justifyContent: 'space-between',
                                                    transition: 'all 0.2s ease',
                                                    boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
                                                }}
                                            >
                                                <div>
                                                    {/* Top Tag & Time */}
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                        <span 
                                                            className="md-badge"
                                                            style={{
                                                                fontSize: '11px',
                                                                background: getCategoryConfig(item.assetType).bgSoft,
                                                                color: getCategoryConfig(item.assetType).color,
                                                                fontWeight: 600
                                                            }}
                                                        >
                                                            {item.assetType.toUpperCase()}
                                                        </span>
                                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <Clock size={11} />
                                                            {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A'}
                                                        </span>
                                                    </div>

                                                    {/* Thumbnail or Icon Preview */}
                                                    {isImage ? (
                                                        <div 
                                                            style={{
                                                                height: '130px',
                                                                borderRadius: '6px',
                                                                overflow: 'hidden',
                                                                background: '#0f172a',
                                                                marginBottom: '10px',
                                                                cursor: 'pointer',
                                                                position: 'relative'
                                                            }}
                                                            onClick={() => setZoomImageSrc(assetUrl(item.url))}
                                                            title="Click to zoom preview"
                                                        >
                                                            <img 
                                                                src={assetUrl(item.url)} 
                                                                alt={item.title || 'Asset preview'} 
                                                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                                            />
                                                            <span style={{
                                                                position: 'absolute',
                                                                bottom: 6,
                                                                right: 6,
                                                                background: 'rgba(0,0,0,0.75)',
                                                                color: 'var(--text-on-color)',
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                fontSize: '10px',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '3px'
                                                            }}>
                                                                <Maximize2 size={10} /> Zoom
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div 
                                                            style={{
                                                                height: '80px',
                                                                borderRadius: '6px',
                                                                background: 'var(--bg-base)',
                                                                border: '1px dashed var(--border-color)',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                marginBottom: '10px',
                                                                gap: '4px'
                                                            }}
                                                        >
                                                            <FileCode size={26} color="var(--primary)" />
                                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                                                {item.filename ? item.filename.split('.').pop().toUpperCase() : 'DOC'} FILE
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Title & Metadata */}
                                                    <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-main)', marginBottom: '4px', wordBreak: 'break-word' }}>
                                                        {item.title || item.filename || 'Untitled Asset'}
                                                    </div>

                                                    {item.candidateName && (
                                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                                                            <User size={12} />
                                                            <span>{item.candidateName} {item.rollNumber ? `(${item.rollNumber})` : ''}</span>
                                                        </div>
                                                    )}

                                                    {item.examId && (
                                                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                                                            <Hash size={11} />
                                                            <span>Exam: {item.examId}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Action Buttons */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', borderTop: '1px solid var(--bg-muted)', paddingTop: '8px' }}>
                                                    {onPreview && (
                                                        <button 
                                                            className="md-btn md-btn-sm md-btn-outlined" 
                                                            style={{ flex: 1, fontSize: '11.5px', padding: '3px 6px', justifyContent: 'center' }}
                                                            onClick={() => onPreview(item)}
                                                            title="Inspect in modal"
                                                        >
                                                            <Eye size={12} />
                                                            <span>Preview</span>
                                                        </button>
                                                    )}

                                                    <button 
                                                        className="md-btn md-btn-sm" 
                                                        style={{ flex: 1, fontSize: '11.5px', padding: '3px 6px', background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-soft)', justifyContent: 'center' }}
                                                        onClick={() => handleDownload(item)}
                                                        title="Download original file"
                                                    >
                                                        <Download size={12} />
                                                        <span>Download</span>
                                                    </button>

                                                    <a 
                                                        href={assetUrl(item.url)} 
                                                        target="_blank" 
                                                        rel="noreferrer"
                                                        className="asset-icon-btn"
                                                        style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                        title="Open in new browser tab"
                                                    >
                                                        <ExternalLink size={13} />
                                                    </a>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Overlay Footer */}
                        <div style={{
                            padding: '12px 20px',
                            background: 'var(--bg-surface)',
                            borderTop: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Showing {categoryItems.length} items from Cloudinary / Local storage
                            </span>
                            
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {onSwitchToAssets && (
                                    <button 
                                        className="md-btn md-btn-sm md-btn-outlined"
                                        onClick={() => { setSelectedCategory(null); onSwitchToAssets(); }}
                                        style={{ fontSize: '12px', padding: '4px 10px' }}
                                    >
                                        <FolderKanban size={13} />
                                        <span>Full Storage Manager &rarr;</span>
                                    </button>
                                )}
                                <button 
                                    className="md-btn md-btn-sm md-btn-primary"
                                    onClick={() => setSelectedCategory(null)}
                                    style={{ fontSize: '12px', padding: '4px 14px' }}
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Standalone Zoom Lightbox Modal */}
            {zoomImageSrc && (
                <div className="lightbox-overlay" onClick={() => setZoomImageSrc(null)} style={{ zIndex: 1100 }}>
                    <div className="lightbox-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '850px' }}>
                        <div className="lightbox-header">
                            <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>
                                Asset Visual Preview
                            </span>
                            <button className="asset-icon-btn" onClick={() => setZoomImageSrc(null)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="lightbox-body" style={{ background: '#000', padding: '10px' }}>
                            <img src={zoomImageSrc} alt="Zoom Preview" className="lightbox-img" style={{ maxHeight: '70vh', objectFit: 'contain' }} />
                        </div>
                        <div className="lightbox-footer" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                            <a href={zoomImageSrc} target="_blank" rel="noreferrer" className="google-btn google-btn-outlined">
                                <ExternalLink size={14} /> Open Full
                            </a>
                            <button className="google-btn google-btn-primary" onClick={() => setZoomImageSrc(null)}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
