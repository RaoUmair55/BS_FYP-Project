import React, { useState } from 'react';
import { 
    Shield, 
    Search, 
    Download, 
    RefreshCw, 
    User, 
    Calendar, 
    Filter, 
    ChevronDown, 
    ChevronUp,
    FileSpreadsheet,
    Activity,
    Info
} from 'lucide-react';

export default function AuditLogView({ 
    logs, 
    loading, 
    onRefresh, 
    onExportCSV 
}) {
    const [actionFilter, setActionFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedLogId, setExpandedLogId] = useState(null);

    const filteredLogs = (logs || []).filter(log => {
        if (actionFilter !== 'all' && log.action !== actionFilter) {
            return false;
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchTeacher = (log.teacherName || '').toLowerCase().includes(q) || (log.teacherEmail || '').toLowerCase().includes(q);
            const matchSummary = (log.targetSummary || '').toLowerCase().includes(q);
            const matchAction = (log.action || '').toLowerCase().includes(q);
            const matchIp = (log.ipAddress || '').toLowerCase().includes(q);
            return matchTeacher || matchSummary || matchAction || matchIp;
        }
        return true;
    });

    const getActionBadge = (action) => {
        switch (action) {
            case 'VIOLATION_REVIEWED':
                return <span className="admin-chip chip-action-review">Reviewed Violation</span>;
            case 'SESSION_TERMINATED':
                return <span className="admin-chip chip-action-terminate">Terminated Candidate</span>;
            case 'EXAM_CREATED':
                return <span className="admin-chip chip-action-exam">Created Exam</span>;
            case 'EXAM_DELETED':
                return <span className="admin-chip chip-action-delete">Deleted Exam</span>;
            case 'PAPER_UPDATED':
                return <span className="admin-chip chip-paper">Updated Paper</span>;
            case 'ASSET_DELETED':
            case 'BATCH_ASSETS_DELETED':
            case 'EXAM_ASSETS_PURGED':
                return <span className="admin-chip chip-action-delete">Purged Storage</span>;
            case 'VERIFICATION_REVIEWED':
                return <span className="admin-chip chip-verification">Camera Verified</span>;
            default:
                return <span className="admin-chip">{action.replace(/_/g, ' ')}</span>;
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Toolbar Header */}
            <div className="admin-toolbar">
                <div className="admin-filter-group">
                    <div className="google-search-input">
                        <Search size={16} color="#5f6368" />
                        <input 
                            type="text" 
                            placeholder="Search examiner, action, student..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <select 
                        className="google-select"
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                    >
                        <option value="all">All Examiner Actions</option>
                        <option value="VIOLATION_REVIEWED">Violation Reviews</option>
                        <option value="SESSION_TERMINATED">Session Terminations</option>
                        <option value="VERIFICATION_REVIEWED">Camera Verifications</option>
                        <option value="EXAM_CREATED">Exam Creations</option>
                        <option value="EXAM_DELETED">Exam Deletions</option>
                        <option value="PAPER_UPDATED">Paper Updates</option>
                        <option value="ASSET_DELETED">Storage Deletions</option>
                    </select>

                    <button className="google-btn google-btn-outlined" onClick={onRefresh} title="Refresh audit feed">
                        <RefreshCw size={14} className={loading ? 'spin' : ''} />
                        Refresh
                    </button>
                </div>

                <div className="admin-filter-group">
                    <button className="google-btn google-btn-primary" onClick={onExportCSV} title="Export CSV for institutional compliance">
                        <FileSpreadsheet size={14} />
                        Export Audit Log (CSV)
                    </button>
                </div>
            </div>

            {/* Main Audit Table */}
            {loading ? (
                <div style={{ padding: '60px', textAlign: 'center', color: '#5f6368' }}>
                    <div className="auth-spinner" style={{ margin: '0 auto 16px auto' }}></div>
                    <span>Loading Teacher Action Audit Trail...</span>
                </div>
            ) : filteredLogs.length === 0 ? (
                <div className="admin-card" style={{ padding: '60px', textAlign: 'center', color: '#5f6368' }}>
                    <Activity size={40} color="#dadce0" style={{ margin: '0 auto 12px auto' }} />
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#202124', marginBottom: '4px' }}>No audit records found</div>
                    <div style={{ fontSize: '13px' }}>Actions performed by teachers and examiners will automatically record here.</div>
                </div>
            ) : (
                <div className="admin-table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th style={{ width: '170px' }}>Timestamp</th>
                                <th>Examiner</th>
                                <th>Action</th>
                                <th>Target & Summary</th>
                                <th>IP Address</th>
                                <th style={{ textAlign: 'right', width: '70px' }}>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLogs.map(log => {
                                const isExpanded = expandedLogId === log._id;
                                const dateObj = new Date(log.timestamp);

                                return (
                                    <React.Fragment key={log._id}>
                                        <tr>
                                            <td style={{ fontSize: '12px', color: '#5f6368', whiteSpace: 'nowrap' }}>
                                                <div>{dateObj.toLocaleDateString()}</div>
                                                <div style={{ color: '#80868b', fontSize: '11px' }}>{dateObj.toLocaleTimeString()}</div>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#e8f0fe', color: '#1a73e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>
                                                        {(log.teacherName || 'E')[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 600, color: '#202124' }}>{log.teacherName || 'Examiner'}</div>
                                                        <div style={{ fontSize: '11px', color: '#5f6368' }}>{log.teacherEmail}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>{getActionBadge(log.action)}</td>
                                            <td>
                                                <div style={{ fontWeight: 500, color: '#202124' }}>
                                                    {log.targetSummary || 'Action performed'}
                                                </div>
                                                {log.targetId && (
                                                    <div style={{ fontSize: '11px', color: '#80868b', fontFamily: 'monospace' }}>
                                                        ID: {log.targetId}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ fontSize: '12px', color: '#5f6368', fontFamily: 'monospace' }}>
                                                {log.ipAddress || '127.0.0.1'}
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                <button 
                                                    className="asset-icon-btn"
                                                    onClick={() => setExpandedLogId(isExpanded ? null : log._id)}
                                                    title={isExpanded ? "Collapse metadata" : "Expand metadata"}
                                                >
                                                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                </button>
                                            </td>
                                        </tr>

                                        {/* Expandable JSON details row */}
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan="6" style={{ background: '#f8f9fa', padding: '16px', borderBottom: '1px solid #dadce0' }}>
                                                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#3c4043', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <Info size={14} color="#1a73e8" />
                                                        Audit Action Event Payload
                                                    </div>
                                                    <pre style={{ margin: 0, padding: '12px', background: '#0f172a', color: '#38bdf8', borderRadius: '6px', fontSize: '12px', overflowX: 'auto' }}>
                                                        {JSON.stringify({
                                                            action: log.action,
                                                            targetType: log.targetType,
                                                            targetId: log.targetId,
                                                            targetSummary: log.targetSummary,
                                                            details: log.details,
                                                            examiner: { name: log.teacherName, email: log.teacherEmail },
                                                            ipAddress: log.ipAddress,
                                                            timestamp: log.timestamp
                                                        }, null, 2)}
                                                    </pre>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

        </div>
    );
}
