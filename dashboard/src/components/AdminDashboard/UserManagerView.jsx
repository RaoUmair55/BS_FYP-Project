import React, { useState } from 'react';
import { 
    Users, 
    Shield, 
    Search, 
    RefreshCw, 
    UserCheck, 
    UserX, 
    Layers, 
    Calendar, 
    Mail, 
    ShieldCheck, 
    ArrowUpRight, 
    AlertTriangle 
} from 'lucide-react';

export default function UserManagerView({ 
    users, 
    loading, 
    onRefresh, 
    onRoleChange, 
    currentUserId 
}) {
    const [roleFilter, setRoleFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedUserForRoleChange, setSelectedUserForRoleChange] = useState(null);
    const [isUpdating, setIsUpdating] = useState(false);

    const filteredUsers = (users || []).filter(u => {
        if (roleFilter !== 'all' && u.role !== roleFilter) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchName = (u.name || '').toLowerCase().includes(q);
            const matchEmail = (u.email || '').toLowerCase().includes(q);
            return matchName || matchEmail;
        }
        return true;
    });

    const handleConfirmRoleChange = async () => {
        if (!selectedUserForRoleChange) return;
        const newRole = selectedUserForRoleChange.role === 'admin' ? 'teacher' : 'admin';
        setIsUpdating(true);
        try {
            await onRoleChange(selectedUserForRoleChange.id, newRole);
            setSelectedUserForRoleChange(null);
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Toolbar */}
            <div className="admin-toolbar">
                <div className="admin-filter-group">
                    <div className="google-search-input">
                        <Search size={16} color="#5f6368" />
                        <input 
                            type="text" 
                            placeholder="Search examiner by name or email..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <select 
                        className="google-select"
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                    >
                        <option value="all">All Roles</option>
                        <option value="admin">Administrators</option>
                        <option value="teacher">Examiners / Teachers</option>
                    </select>

                    <button className="google-btn google-btn-outlined" onClick={onRefresh} title="Refresh users list">
                        <RefreshCw size={14} className={loading ? 'spin' : ''} />
                        Refresh
                    </button>
                </div>

                <div style={{ fontSize: '13px', color: '#5f6368' }}>
                    Total Users: <strong>{filteredUsers.length}</strong>
                </div>
            </div>

            {/* Main Table */}
            {loading ? (
                <div style={{ padding: '60px', textAlign: 'center', color: '#5f6368' }}>
                    <div className="auth-spinner" style={{ margin: '0 auto 16px auto' }}></div>
                    <span>Loading registered users & examiners...</span>
                </div>
            ) : filteredUsers.length === 0 ? (
                <div className="admin-card" style={{ padding: '60px', textAlign: 'center', color: '#5f6368' }}>
                    <Users size={40} color="#dadce0" style={{ margin: '0 auto 12px auto' }} />
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#202124', marginBottom: '4px' }}>No users found</div>
                    <div style={{ fontSize: '13px' }}>No user accounts match your selected filter criteria.</div>
                </div>
            ) : (
                <div className="admin-table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Examiner / User</th>
                                <th>Role</th>
                                <th>Exams Created</th>
                                <th>Registered Date</th>
                                <th style={{ textAlign: 'right' }}>Role Management</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map(user => {
                                const isAdmin = user.role === 'admin';
                                const isSelf = currentUserId && String(currentUserId) === String(user.id);

                                return (
                                    <tr key={user.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <div style={{
                                                    width: '32px',
                                                    height: '32px',
                                                    borderRadius: '50%',
                                                    background: isAdmin ? 'linear-gradient(135deg, #1a73e8, #7c3aed)' : '#f1f3f4',
                                                    color: isAdmin ? '#ffffff' : '#3c4043',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '13px',
                                                    fontWeight: 700
                                                }}>
                                                    {(user.name || 'U')[0].toUpperCase()}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 600, color: '#202124', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {user.name}
                                                        {isSelf && (
                                                            <span style={{ fontSize: '10px', background: '#e8f0fe', color: '#1a73e8', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                                                YOU
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: '#5f6368', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Mail size={12} />
                                                        {user.email}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            {isAdmin ? (
                                                <span className="admin-chip chip-paper" style={{ background: '#e8f0fe', color: '#1a73e8', fontWeight: 700 }}>
                                                    🛡️ Administrator
                                                </span>
                                            ) : (
                                                <span className="admin-chip chip-verification" style={{ background: '#f1f3f4', color: '#5f6368' }}>
                                                    Teacher / Examiner
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#3c4043' }}>
                                                <Layers size={14} color="#5f6368" />
                                                <span>{user.examsCount || 0} exams</span>
                                            </div>
                                        </td>
                                        <td style={{ fontSize: '12px', color: '#5f6368' }}>
                                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            {isAdmin ? (
                                                <button 
                                                    className="google-btn google-btn-outlined" 
                                                    onClick={() => setSelectedUserForRoleChange(user)}
                                                    title="Demote to standard teacher"
                                                    style={{ fontSize: '12px', padding: '5px 10px' }}
                                                >
                                                    <UserX size={13} color="#d93025" />
                                                    Demote to Teacher
                                                </button>
                                            ) : (
                                                <button 
                                                    className="google-btn google-btn-primary" 
                                                    onClick={() => setSelectedUserForRoleChange(user)}
                                                    title="Grant Full Administrator Privileges"
                                                    style={{ fontSize: '12px', padding: '5px 10px' }}
                                                >
                                                    <ShieldCheck size={13} />
                                                    Promote to Admin
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Role Change Confirmation Modal */}
            {selectedUserForRoleChange && (
                <div className="lightbox-overlay" onClick={() => !isUpdating && setSelectedUserForRoleChange(null)}>
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-dialog-header">
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: selectedUserForRoleChange.role === 'admin' ? '#fce8e6' : '#e8f0fe', color: selectedUserForRoleChange.role === 'admin' ? '#d93025' : '#1a73e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Shield size={20} />
                            </div>
                            <h3 className="modal-dialog-title">
                                {selectedUserForRoleChange.role === 'admin' ? 'Demote Administrator?' : 'Promote to Administrator?'}
                            </h3>
                        </div>
                        <div className="modal-dialog-body">
                            {selectedUserForRoleChange.role === 'admin' ? (
                                <>
                                    Are you sure you want to remove administrator privileges from <strong>{selectedUserForRoleChange.name}</strong> ({selectedUserForRoleChange.email})?
                                    <br /><br />
                                    They will no longer have access to the Admin & Storage Console, storage purge tools, or audit trails.
                                </>
                            ) : (
                                <>
                                    Are you sure you want to promote <strong>{selectedUserForRoleChange.name}</strong> ({selectedUserForRoleChange.email}) to <strong>Administrator</strong>?
                                    <br /><br />
                                    They will receive full access to Cloudinary asset deletion, system analytics, and examiner audit trails.
                                </>
                            )}
                        </div>
                        <div className="modal-dialog-actions">
                            <button 
                                className="google-btn google-btn-outlined" 
                                onClick={() => setSelectedUserForRoleChange(null)}
                                disabled={isUpdating}
                            >
                                Cancel
                            </button>
                            <button 
                                className={`google-btn ${selectedUserForRoleChange.role === 'admin' ? 'google-btn-danger' : 'google-btn-primary'}`} 
                                onClick={handleConfirmRoleChange}
                                disabled={isUpdating}
                            >
                                {isUpdating ? 'Updating Role...' : selectedUserForRoleChange.role === 'admin' ? 'Demote to Teacher' : 'Promote to Admin'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
