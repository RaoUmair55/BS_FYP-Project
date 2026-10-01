import React, { useState } from 'react';
import { assetUrl } from '../../services/api';
import { 
    FileText, 
    Image, 
    Trash2, 
    Download, 
    ExternalLink, 
    Search, 
    Filter, 
    RefreshCw, 
    Grid, 
    List, 
    Eye, 
    CheckSquare, 
    Square, 
    AlertTriangle,
    Copy,
    Check,
    FolderX
} from 'lucide-react';

export default function AssetManagerView({ 
    assets, 
    loading, 
    onRefresh, 
    onDeleteSingle, 
    onDeleteBatch, 
    onPurgeExam, 
    onPreview 
}) {
    const [filterType, setFilterType] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
    const [selectedIds, setSelectedIds] = useState([]);
    const [copiedId, setCopiedId] = useState(null);

    // Filter items locally based on filterType and searchQuery
    const filteredAssets = (assets || []).filter(item => {
        if (filterType !== 'all') {
            if (filterType === 'papers' && item.assetType !== 'paper') return false;
            if (filterType === 'verification' && item.assetType !== 'verification') return false;
            if (filterType === 'screenshots' && item.assetType !== 'screenshot') return false;
            if (filterType === 'submissions' && item.assetType !== 'submission') return false;
        }
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

    const isAllSelected = filteredAssets.length > 0 && selectedIds.length === filteredAssets.length;

    const toggleSelectAll = () => {
        if (isAllSelected) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredAssets.map(a => a.id));
        }
    };

    const toggleSelectItem = (id) => {
        setSelectedIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
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
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const getAssetChip = (type) => {
        switch (type) {
            case 'paper':
                return <span className="admin-chip chip-paper">Exam Paper</span>;
            case 'verification':
                return <span className="admin-chip chip-verification">Verification Photo</span>;
            case 'screenshot':
                return <span className="admin-chip chip-screenshot">Screenshot</span>;
            case 'submission':
                return <span className="admin-chip chip-submission">Submission</span>;
            default:
                return <span className="admin-chip">{type}</span>;
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Toolbar Header */}
            <div className="admin-toolbar">
                <div className="admin-filter-group">
                    {/* Search Input */}
                    <div className="google-search-input">
                        <Search size={16} color="var(--text-muted)" />
                        <input 
                            type="text" 
                            placeholder="Search candidate, exam, file..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Filter Type Tabs */}
                    <select 
                        className="google-select" 
                        value={filterType} 
                        onChange={(e) => setFilterType(e.target.value)}
                    >
                        <option value="all">All Storage Media</option>
                        <option value="papers">Question Papers (PDF/DOCX)</option>
                        <option value="verification">Verification Photos</option>
                        <option value="screenshots">Violation Screenshots</option>
                        <option value="submissions">Candidate Submissions</option>
                    </select>

                    {/* View Switcher */}
                    <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                        <button 
                            className="asset-icon-btn" 
                            style={{ borderRadius: 0, border: 'none', background: viewMode === 'grid' ? 'var(--primary-soft)' : 'var(--bg-surface)', color: viewMode === 'grid' ? 'var(--primary)' : 'var(--text-muted)' }}
                            onClick={() => setViewMode('grid')}
                            title="Grid View"
                        >
                            <Grid size={15} />
                        </button>
                        <button 
                            className="asset-icon-btn" 
                            style={{ borderRadius: 0, border: 'none', borderLeft: '1px solid var(--border-color)', background: viewMode === 'table' ? 'var(--primary-soft)' : 'var(--bg-surface)', color: viewMode === 'table' ? 'var(--primary)' : 'var(--text-muted)' }}
                            onClick={() => setViewMode('table')}
                            title="Table View"
                        >
                            <List size={15} />
                        </button>
                    </div>

                    <button className="google-btn google-btn-outlined" onClick={onRefresh} title="Refresh assets">
                        <RefreshCw size={14} className={loading ? 'spin' : ''} />
                        Refresh
                    </button>
                </div>

                {/* Batch Action Buttons */}
                <div className="admin-filter-group">
                    {selectedIds.length > 0 && (
                        <button 
                            className="google-btn google-btn-danger"
                            onClick={() => {
                                const selectedItems = filteredAssets
                                    .filter(a => selectedIds.includes(a.id))
                                    .map(a => ({ id: a.id, type: a.assetType }));
                                onDeleteBatch(selectedItems);
                            }}
                        >
                            <Trash2 size={14} />
                            Delete ({selectedIds.length})
                        </button>
                    )}

                    <button className="google-btn google-btn-outlined" onClick={onPurgeExam} title="Clean up all media for a specific completed exam">
                        <FolderX size={14} color="var(--danger)" />
                        Purge by Exam
                    </button>
                </div>
            </div>

            {/* Selection Status Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)', padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={toggleSelectAll}>
                    {isAllSelected ? <CheckSquare size={16} color="var(--primary)" /> : <Square size={16} color="var(--text-muted)" />}
                    <span>Select All ({filteredAssets.length} items)</span>
                </div>
                {selectedIds.length > 0 && (
                    <span><strong>{selectedIds.length}</strong> items selected</span>
                )}
            </div>

            {/* Main Content Area */}
            {loading ? (
                <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div className="auth-spinner" style={{ margin: '0 auto 16px auto' }}></div>
                    <span>Loading evidence assets...</span>
                </div>
            ) : filteredAssets.length === 0 ? (
                <div className="admin-card" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <FileText size={40} color="var(--text-muted)" style={{ margin: '0 auto 12px auto' }} />
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>No media assets found</div>
                    <div style={{ fontSize: '13px' }}>No files match your selected filter or search criteria.</div>
                </div>
            ) : viewMode === 'grid' ? (
                /* GRID VIEW */
                <div className="asset-cards-grid">
                    {filteredAssets.map(item => {
                        const isSelected = selectedIds.includes(item.id);
                        const isImage = item.assetType === 'verification' || item.assetType === 'screenshot' || (item.url && item.url.match(/\.(jpg|jpeg|png|webp)/i));

                        return (
                            <div key={item.id} className={`asset-card ${isSelected ? 'selected' : ''}`}>
                                
                                {/* Selection Checkbox */}
                                <div className="asset-checkbox-wrapper" onClick={() => toggleSelectItem(item.id)}>
                                    {isSelected ? <CheckSquare size={18} color="var(--primary)" /> : <Square size={18} color="var(--text-muted)" />}
                                </div>

                                {/* Preview Area */}
                                <div className="asset-preview-container" onClick={() => onPreview({ ...item, url: assetUrl(item.url) })}>
                                    {isImage && item.url ? (
                                        <img src={assetUrl(item.url)} alt={item.title} className="asset-preview-img" loading="lazy" />
                                    ) : (
                                        <div className="asset-paper-icon-preview">
                                            <FileText size={36} color="var(--text-muted)" />
                                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{item.filename || 'Document'}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Card Body */}
                                <div className="asset-card-body">
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            {getAssetChip(item.assetType)}
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}
                                            </span>
                                        </div>
                                        <div className="asset-card-title" title={item.title}>
                                            {item.candidateName ? `${item.candidateName} ${item.rollNumber ? `(${item.rollNumber})` : ''}` : item.title}
                                        </div>
                                        <div className="asset-card-meta">
                                            <span>Exam: <strong>{item.examId || 'N/A'}</strong></span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.filename}>
                                                File: {item.filename}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Action Footer */}
                                    <div className="asset-card-footer">
                                        <div className="asset-action-btn-group">
                                            <button className="asset-icon-btn" onClick={() => onPreview({ ...item, url: assetUrl(item.url) })} title="Quick Preview">
                                                <Eye size={14} />
                                            </button>
                                            <button className="asset-icon-btn" onClick={() => handleDownload(item)} title="Download / Open Cloudinary CDN">
                                                <Download size={14} />
                                            </button>
                                            <button className="asset-icon-btn" onClick={() => handleCopyLink(assetUrl(item.url), item.id)} title="Copy CDN Link">
                                                {copiedId === item.id ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                        <button 
                                            className="asset-icon-btn delete" 
                                            onClick={() => onDeleteSingle(item)}
                                            title="Permanently Delete"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /* TABLE VIEW */
                <div className="admin-table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th style={{ width: '40px' }}>
                                    <div onClick={toggleSelectAll} style={{ cursor: 'pointer' }}>
                                        {isAllSelected ? <CheckSquare size={16} color="var(--primary)" /> : <Square size={16} color="var(--text-muted)" />}
                                    </div>
                                </th>
                                <th>Category</th>
                                <th>Asset Details / Candidate</th>
                                <th>Exam ID</th>
                                <th>Filename</th>
                                <th>Timestamp</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAssets.map(item => {
                                const isSelected = selectedIds.includes(item.id);
                                return (
                                    <tr key={item.id} style={{ background: isSelected ? 'var(--bg-base)' : 'transparent' }}>
                                        <td>
                                            <div onClick={() => toggleSelectItem(item.id)} style={{ cursor: 'pointer' }}>
                                                {isSelected ? <CheckSquare size={16} color="var(--primary)" /> : <Square size={16} color="var(--text-muted)" />}
                                            </div>
                                        </td>
                                        <td>{getAssetChip(item.assetType)}</td>
                                        <td>
                                            <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                                                {item.candidateName || item.title}
                                            </div>
                                            {item.rollNumber && (
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Roll: {item.rollNumber}</div>
                                            )}
                                        </td>
                                        <td><span className="md-badge" style={{ background: 'var(--bg-muted)', fontSize: '11px' }}>{item.examId || 'N/A'}</span></td>
                                        <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.filename}>
                                            {item.filename}
                                        </td>
                                        <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                            {item.createdAt ? new Date(item.createdAt).toLocaleString() : 'N/A'}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                                                <button className="asset-icon-btn" onClick={() => onPreview({ ...item, url: assetUrl(item.url) })} title="Quick Preview">
                                                    <Eye size={14} />
                                                </button>
                                                <button className="asset-icon-btn" onClick={() => handleDownload(item)} title="Download / Open CDN">
                                                    <Download size={14} />
                                                </button>
                                                <button className="asset-icon-btn" onClick={() => handleCopyLink(assetUrl(item.url), item.id)} title="Copy Link">
                                                    {copiedId === item.id ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                                                </button>
                                                <button className="asset-icon-btn delete" onClick={() => onDeleteSingle(item)} title="Permanently Delete">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

        </div>
    );
}
