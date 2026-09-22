import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import AnalyticsView from './AnalyticsView';
import AssetManagerView from './AssetManagerView';
import AuditLogView from './AuditLogView';
import UserManagerView from './UserManagerView';
import { 
    Shield, 
    BarChart3, 
    FolderKanban, 
    ScrollText, 
    Users,
    X, 
    Download, 
    ExternalLink, 
    AlertTriangle, 
    Trash2, 
    Copy, 
    Check, 
    FileText,
    FolderX
} from 'lucide-react';
import './AdminDashboard.css';

const API_BASE = 'http://localhost:5000';

export default function AdminDashboard({ onNavigateExams, onNavigateMonitoring }) {
    const { authFetch, teacher } = useAuth();

    const [activeSubtab, setActiveSubtab] = useState('analytics'); // 'analytics' | 'assets' | 'audit' | 'users'

    // Data States
    const [stats, setStats] = useState(null);
    const [loadingStats, setLoadingStats] = useState(false);

    const [assets, setAssets] = useState([]);
    const [loadingAssets, setLoadingAssets] = useState(false);

    const [auditLogs, setAuditLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(false);

    // Modal States
    const [previewItem, setPreviewItem] = useState(null);
    const [singleDeleteItem, setSingleDeleteItem] = useState(null);
    const [batchDeleteItems, setBatchDeleteItems] = useState(null);
    const [showPurgeModal, setShowPurgeModal] = useState(false);
    const [purgeExamId, setPurgeExamId] = useState('');
    const [purgeLoading, setPurgeLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    // Notification toast
    const [toast, setToast] = useState(null);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    // 1. Fetch Stats
    const fetchStats = async () => {
        setLoadingStats(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/stats`);
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (err) {
            console.error('Failed to load stats:', err);
        } finally {
            setLoadingStats(false);
        }
    };

    // 2. Fetch Assets
    const fetchAssets = async () => {
        setLoadingAssets(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/assets?type=all&limit=200`);
            if (res.ok) {
                const data = await res.json();
                setAssets(data.items || []);
            }
        } catch (err) {
            console.error('Failed to load assets:', err);
        } finally {
            setLoadingAssets(false);
        }
    };

    // 3. Fetch Audit Logs
    const fetchAuditLogs = async () => {
        setLoadingLogs(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/audit-logs?limit=100`);
            if (res.ok) {
                const data = await res.json();
                setAuditLogs(data.logs || []);
            }
        } catch (err) {
            console.error('Failed to load audit logs:', err);
        } finally {
            setLoadingLogs(false);
        }
    };

    // 4. Fetch Users
    const fetchUsers = async () => {
        setLoadingUsers(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/users?limit=100`);
            if (res.ok) {
                const data = await res.json();
                setUsers(data.users || []);
            }
        } catch (err) {
            console.error('Failed to load users:', err);
        } finally {
            setLoadingUsers(false);
        }
    };

    // Initial Fetch & Refresh on Tab Change
    useEffect(() => {
        fetchStats();
        fetchAssets();
        fetchAuditLogs();
        fetchUsers();
    }, []);

    // Role Change Handler
    const handleRoleChange = async (userId, newRole) => {
        try {
            const res = await authFetch(`${API_BASE}/admin/users/${userId}/role`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });
            if (res.ok) {
                showToast(`Role updated to ${newRole.toUpperCase()} successfully.`);
                fetchUsers();
                fetchAuditLogs();
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to update role', 'error');
            }
        } catch (err) {
            showToast('Network error while updating role', 'error');
        }
    };

    // Delete single asset handler
    const confirmDeleteSingle = async () => {
        if (!singleDeleteItem) return;
        setActionLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/assets/${singleDeleteItem.assetType}/${singleDeleteItem.id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showToast('Asset permanently deleted from Cloudinary and database.');
                setSingleDeleteItem(null);
                fetchAssets();
                fetchStats();
                fetchAuditLogs();
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to delete asset', 'error');
            }
        } catch (err) {
            showToast('Network error while deleting asset', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    // Batch delete handler
    const confirmDeleteBatch = async () => {
        if (!batchDeleteItems || batchDeleteItems.length === 0) return;
        setActionLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/assets/batch-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: batchDeleteItems })
            });
            if (res.ok) {
                const result = await res.json();
                showToast(`Batch deleted ${result.deletedCount} assets successfully.`);
                setBatchDeleteItems(null);
                fetchAssets();
                fetchStats();
                fetchAuditLogs();
            } else {
                const err = await res.json();
                showToast(err.error || 'Batch delete failed', 'error');
            }
        } catch (err) {
            showToast('Network error during batch delete', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    // Purge exam assets handler
    const handlePurgeExam = async () => {
        if (!purgeExamId.trim()) return;
        setPurgeLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/assets/purge-exam`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    examId: purgeExamId.trim(),
                    purgePapers: true,
                    purgeScreenshots: true,
                    purgeVerification: true
                })
            });
            if (res.ok) {
                const result = await res.json();
                showToast(`Purged ${result.totalPurged} files for Exam ${purgeExamId}.`);
                setShowPurgeModal(false);
                setPurgeExamId('');
                fetchAssets();
                fetchStats();
                fetchAuditLogs();
            } else {
                const err = await res.json();
                showToast(err.error || 'Purge failed', 'error');
            }
        } catch (err) {
            showToast('Network error during purge', 'error');
        } finally {
            setPurgeLoading(false);
        }
    };

    // Export Audit Logs as CSV
    const handleExportCSV = async () => {
        try {
            const res = await authFetch(`${API_BASE}/admin/audit-logs/export`);
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `IntegrityFlow_Audit_Log_${new Date().toISOString().substring(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                showToast('Audit log CSV exported successfully.');
            }
        } catch (err) {
            showToast('Failed to export audit log CSV', 'error');
        }
    };

    return (
        <div className="admin-dashboard-container">
            
            {/* Toast Notification */}
            {toast && (
                <div style={{
                    position: 'fixed',
                    bottom: '24px',
                    right: '24px',
                    background: toast.type === 'error' ? '#d93025' : '#188038',
                    color: '#ffffff',
                    padding: '12px 20px',
                    borderRadius: '8px',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
                    fontSize: '13px',
                    fontWeight: 500,
                    zIndex: 10000,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                }}>
                    <span>{toast.message}</span>
                    <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}>
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Header Section */}
            <div className="admin-header">
                <div className="admin-title-area">
                    <div className="admin-icon-bubble">
                        <Shield size={22} />
                    </div>
                    <div>
                        <h1 className="admin-heading">Admin & Asset Management Console</h1>
                        <p className="admin-subheading">Manage Cloudinary storage, question papers, candidate verification media, and examiner audit trails</p>
                    </div>
                </div>

                {/* Sub-navigation Tabs */}
                <div className="admin-subtabs">
                    <button 
                        className={`admin-subtab-btn ${activeSubtab === 'analytics' ? 'active' : ''}`}
                        onClick={() => setActiveSubtab('analytics')}
                    >
                        <BarChart3 size={16} />
                        Analytics & Metrics
                    </button>
                    <button 
                        className={`admin-subtab-btn ${activeSubtab === 'assets' ? 'active' : ''}`}
                        onClick={() => setActiveSubtab('assets')}
                    >
                        <FolderKanban size={16} />
                        Storage & Assets ({stats?.storage?.totalAssets || assets.length})
                    </button>
                    <button 
                        className={`admin-subtab-btn ${activeSubtab === 'audit' ? 'active' : ''}`}
                        onClick={() => setActiveSubtab('audit')}
                    >
                        <ScrollText size={16} />
                        Examiner Audit Trail
                    </button>
                    <button 
                        className={`admin-subtab-btn ${activeSubtab === 'users' ? 'active' : ''}`}
                        onClick={() => setActiveSubtab('users')}
                    >
                        <Users size={16} />
                        User & Role Management ({users.length})
                    </button>
                </div>
            </div>

            {/* Active Sub-view Rendering */}
            {activeSubtab === 'analytics' && (
                <AnalyticsView stats={stats} loading={loadingStats} />
            )}

            {activeSubtab === 'assets' && (
                <AssetManagerView 
                    assets={assets}
                    loading={loadingAssets}
                    onRefresh={fetchAssets}
                    onDeleteSingle={(item) => setSingleDeleteItem(item)}
                    onDeleteBatch={(items) => setBatchDeleteItems(items)}
                    onPurgeExam={() => setShowPurgeModal(true)}
                    onPreview={(item) => setPreviewItem(item)}
                />
            )}

            {activeSubtab === 'audit' && (
                <AuditLogView 
                    logs={auditLogs}
                    loading={loadingLogs}
                    onRefresh={fetchAuditLogs}
                    onExportCSV={handleExportCSV}
                />
            )}

            {activeSubtab === 'users' && (
                <UserManagerView 
                    users={users}
                    loading={loadingUsers}
                    onRefresh={fetchUsers}
                    onRoleChange={handleRoleChange}
                    currentUserId={teacher?.id || teacher?._id}
                />
            )}

            {/* 1. Google Drive Style Lightbox Preview Modal */}
            {previewItem && (
                <div className="lightbox-overlay" onClick={() => setPreviewItem(null)}>
                    <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                        <div className="lightbox-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <FileText size={20} color="#1a73e8" />
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '15px', color: '#202124' }}>
                                        {previewItem.title}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#5f6368' }}>
                                        {previewItem.filename} &bull; Exam: {previewItem.examId || 'N/A'}
                                    </div>
                                </div>
                            </div>
                            <button className="asset-icon-btn" onClick={() => setPreviewItem(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="lightbox-body">
                            {previewItem.assetType === 'verification' || previewItem.assetType === 'screenshot' || (previewItem.url && previewItem.url.match(/\.(jpg|jpeg|png|webp)/i)) ? (
                                <img src={previewItem.url} alt={previewItem.title} className="lightbox-img" />
                            ) : (
                                <div style={{ color: '#fff', textAlign: 'center', padding: '40px' }}>
                                    <FileText size={64} color="#94a3b8" style={{ margin: '0 auto 16px auto' }} />
                                    <div style={{ fontSize: '16px', fontWeight: 600 }}>PDF / Document File</div>
                                    <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>Click download below to open directly from Cloudinary CDN.</div>
                                </div>
                            )}
                        </div>

                        <div className="lightbox-footer">
                            <div style={{ fontSize: '12px', color: '#5f6368' }}>
                                {previewItem.candidateName && <span>Candidate: <strong>{previewItem.candidateName}</strong> | </span>}
                                <span>Uploaded: {new Date(previewItem.createdAt).toLocaleString()}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <a 
                                    href={previewItem.url} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="google-btn google-btn-outlined"
                                >
                                    <ExternalLink size={14} />
                                    Open Direct Link
                                </a>
                                <a 
                                    href={previewItem.url} 
                                    download={previewItem.filename}
                                    className="google-btn google-btn-primary"
                                >
                                    <Download size={14} />
                                    Download File
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. Single Delete Confirmation Modal */}
            {singleDeleteItem && (
                <div className="lightbox-overlay" onClick={() => !actionLoading && setSingleDeleteItem(null)}>
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-dialog-header">
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fce8e6', color: '#d93025', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <AlertTriangle size={20} />
                            </div>
                            <h3 className="modal-dialog-title">Delete Stored File?</h3>
                        </div>
                        <div className="modal-dialog-body">
                            Are you sure you want to permanently delete <strong>{singleDeleteItem.filename || singleDeleteItem.title}</strong>?
                            <br /><br />
                            This will permanently destroy the file from Cloudinary and remove its link from the database. This action cannot be undone.
                        </div>
                        <div className="modal-dialog-actions">
                            <button 
                                className="google-btn google-btn-outlined" 
                                onClick={() => setSingleDeleteItem(null)}
                                disabled={actionLoading}
                            >
                                Cancel
                            </button>
                            <button 
                                className="google-btn google-btn-danger" 
                                onClick={confirmDeleteSingle}
                                disabled={actionLoading}
                            >
                                {actionLoading ? 'Deleting...' : 'Delete Permanently'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 3. Batch Delete Confirmation Modal */}
            {batchDeleteItems && (
                <div className="lightbox-overlay" onClick={() => !actionLoading && setBatchDeleteItems(null)}>
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-dialog-header">
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fce8e6', color: '#d93025', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <AlertTriangle size={20} />
                            </div>
                            <h3 className="modal-dialog-title">Batch Delete Files?</h3>
                        </div>
                        <div className="modal-dialog-body">
                            You are about to permanently delete <strong>{batchDeleteItems.length} selected files</strong> from Cloudinary storage.
                            <br /><br />
                            All associated database records will be cleaned up. This action is irreversible.
                        </div>
                        <div className="modal-dialog-actions">
                            <button 
                                className="google-btn google-btn-outlined" 
                                onClick={() => setBatchDeleteItems(null)}
                                disabled={actionLoading}
                            >
                                Cancel
                            </button>
                            <button 
                                className="google-btn google-btn-danger" 
                                onClick={confirmDeleteBatch}
                                disabled={actionLoading}
                            >
                                {actionLoading ? 'Deleting...' : `Delete ${batchDeleteItems.length} Files`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 4. Purge by Exam Modal */}
            {showPurgeModal && (
                <div className="lightbox-overlay" onClick={() => !purgeLoading && setShowPurgeModal(false)}>
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-dialog-header">
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fce8e6', color: '#d93025', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <FolderX size={20} />
                            </div>
                            <h3 className="modal-dialog-title">Purge All Media for Exam</h3>
                        </div>
                        <div className="modal-dialog-body">
                            Enter the Exam Code or ID to purge all stored question papers, candidate camera verification photos, and violation screenshots from Cloudinary.
                            <div style={{ marginTop: '16px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#202124', marginBottom: '6px' }}>
                                    Exam Code / Exam ID:
                                </label>
                                <input 
                                    type="text" 
                                    placeholder="e.g. EXAM-ZY58XJ" 
                                    className="google-select"
                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                    value={purgeExamId}
                                    onChange={(e) => setPurgeExamId(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="modal-dialog-actions">
                            <button 
                                className="google-btn google-btn-outlined" 
                                onClick={() => setShowPurgeModal(false)}
                                disabled={purgeLoading}
                            >
                                Cancel
                            </button>
                            <button 
                                className="google-btn google-btn-danger" 
                                onClick={handlePurgeExam}
                                disabled={purgeLoading || !purgeExamId.trim()}
                            >
                                {purgeLoading ? 'Purging Files...' : 'Purge All Exam Media'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
