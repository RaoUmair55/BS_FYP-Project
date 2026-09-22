import React, { useState } from 'react';
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

    const handleDownload = (item) => {
        if (!item.url) return;
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.download = item.filename || 'download';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
                        <Search size={16} color="#5f6368" />
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
                    <div style={{ display: 'flex', border: '1px solid #dadce0', borderRadius: '6px', overflow: 'hidden' }}>
                        <button 
                            className="asset-icon-btn" 
                            style={{ borderRadius: 0, border: 'none', background: viewMode === 'grid' ? '#e8f0fe' : '#fff', color: viewMode === 'grid' ? '#1a73e8' : '#5f6368' }}
                            onClick={() => setViewMode('grid')}
                            title="Grid View"
                        >
                            <Grid size={15} />
                        </button>
                        <button 
                            className="asset-icon-btn" 
                            style={{ borderRadius: 0, border: 'none', borderLeft: '1px solid #dadce0', background: viewMode === 'table' ? '#e8f0fe' : '#fff', color: viewMode === 'table' ? '#1a73e8' : '#5f6368' }}
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
                        <FolderX size={14} color="#d93025" />
                        Purge by Exam
                    </button>
                </div>
            </div>

            {/* Selection Status Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: '#5f6368', padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={toggleSelectAll}>
                    {isAllSelected ? <CheckSquare size={16} color="#1a73e8" /> : <Square size={16} color="#5f6368" />}
                    <span>Select All ({filteredAssets.length} items)</span>
                </div>
                {selectedIds.length > 0 && (
                    <span><strong>{selectedIds.length}</strong> items selected</span>
                )}
            </div>

            {/* Main Content Area */}
            {loading ? (
                <div style={{ padding: '60px', textAlign: 'center', color: '#5f6368' }}>
                    <div className="auth-spinner" style={{ margin: '0 auto 16px auto' }}></div>
                    <span>Loading assets from Cloudinary & Database...</span>
                </div>
            ) : filteredAssets.length === 0 ? (
                <div className="admin-card" style={{ padding: '60px', textAlign: 'center', color: '#5f6368' }}>
                    <FileText size={40} color="#dadce0" style={{ margin: '0 auto 12px auto' }} />
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#202124', marginBottom: '4px' }}>No media assets found</div>
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
                                    {isSelected ? <CheckSquare size={18} color="#1a73e8" /> : <Square size={18} color="#5f6368" />}
                                </div>

                                {/* Preview Area */}
                                <div className="asset-preview-container" onClick={() => onPreview(item)}>
                                    {isImage && item.url ? (
                                        <img src={item.url} alt={item.title} className="asset-preview-img" loading="lazy" />
                                    ) : (
                                        <div className="asset-paper-icon-preview">
                                            <FileText size={36} color="#64748b" />
                                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{item.filename || 'Document'}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Card Body */}
                                <div className="asset-card-body">
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            {getAssetChip(item.assetType)}
                                            <span style={{ fontSize: '11px', color: '#80868b' }}>
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
                                            <button className="asset-icon-btn" onClick={() => onPreview(item)} title="Quick Preview">
                                                <Eye size={14} />
                                            </button>
                                            <button className="asset-icon-btn" onClick={() => handleDownload(item)} title="Download / Open Cloudinary CDN">
                                                <Download size={14} />
                                            </button>
                                            <button className="asset-icon-btn" onClick={() => handleCopyLink(item.url, item.id)} title="Copy CDN Link">
                                                {copiedId === item.id ? <Check size={14} color="#188038" /> : <Copy size={14} />}
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
                                        {isAllSelected ? <CheckSquare size={16} color="#1a73e8" /> : <Square size={16} color="#5f6368" />}
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
                                    <tr key={item.id} style={{ background: isSelected ? '#f8fafd' : 'transparent' }}>
                                        <td>
                                            <div onClick={() => toggleSelectItem(item.id)} style={{ cursor: 'pointer' }}>
                                                {isSelected ? <CheckSquare size={16} color="#1a73e8" /> : <Square size={16} color="#5f6368" />}
                                            </div>
                                        </td>
                                        <td>{getAssetChip(item.assetType)}</td>
                                        <td>
                                            <div style={{ fontWeight: 600, color: '#202124' }}>
                                                {item.candidateName || item.title}
                                            </div>
                                            {item.rollNumber && (
                                                <div style={{ fontSize: '11px', color: '#5f6368' }}>Roll: {item.rollNumber}</div>
                                            )}
                                        </td>
                                        <td><span className="md-badge" style={{ background: '#f1f3f4', fontSize: '11px' }}>{item.examId || 'N/A'}</span></td>
                                        <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.filename}>
                                            {item.filename}
                                        </td>
                                        <td style={{ fontSize: '12px', color: '#5f6368' }}>
                                            {item.createdAt ? new Date(item.createdAt).toLocaleString() : 'N/A'}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                                                <button className="asset-icon-btn" onClick={() => onPreview(item)} title="Quick Preview">
                                                    <Eye size={14} />
                                                </button>
                                                <button className="asset-icon-btn" onClick={() => handleDownload(item)} title="Download / Open CDN">
                                                    <Download size={14} />
                                                </button>
                                                <button className="asset-icon-btn" onClick={() => handleCopyLink(item.url, item.id)} title="Copy Link">
                                                    {copiedId === item.id ? <Check size={14} color="#188038" /> : <Copy size={14} />}
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
