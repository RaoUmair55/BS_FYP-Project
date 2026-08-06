import React, { useState, useEffect } from 'react';
import useSocket from '../hooks/useSocket';
import StudentList from '../components/StudentList';
import AlertFeed from '../components/AlertFeed';
import EvidenceViewer from '../components/EvidenceViewer';
import PaperUploader from '../components/PaperUploader';
import './Dashboard.css';

export default function Dashboard() {
    const { connected, violations, riskScores } = useSocket();
    const [selectedSessionId, setSelectedSessionId] = useState(null);
    const [activeTab, setActiveTab] = useState('monitoring'); // 'monitoring' or 'upload'
    const [rightPanelView, setRightPanelView] = useState('feed'); // 'feed' or 'evidence'

    // Auto-switch to evidence when a student is selected
    useEffect(() => {
        if (selectedSessionId) {
            setRightPanelView('evidence');
        }
    }, [selectedSessionId]);

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <h1>IntegrityFlow</h1>
                <div className="header-controls">
                    <div className="tab-buttons">
                        <button 
                            className={activeTab === 'monitoring' ? 'active' : ''} 
                            onClick={() => setActiveTab('monitoring')}
                        >
                            Live Monitoring
                        </button>
                        <button 
                            className={activeTab === 'upload' ? 'active' : ''} 
                            onClick={() => setActiveTab('upload')}
                        >
                            Upload Papers
                        </button>
                    </div>
                    <div className="connection-status">
                        <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
                        {connected ? 'System Online' : 'Offline'}
                    </div>
                </div>
            </header>

            {activeTab === 'upload' ? (
                <main className="dashboard-main-single">
                    <PaperUploader />
                </main>
            ) : (
                <main className="dashboard-main-layout">
                    <div className="dashboard-left">
                        <StudentList 
                            riskScores={riskScores} 
                            onSelectStudent={setSelectedSessionId} 
                            selectedSessionId={selectedSessionId}
                        />
                    </div>
                    
                    <div className="dashboard-right">
                        <div className="right-panel-header">
                            <h2>{rightPanelView === 'feed' ? 'Global Alert Feed' : `Evidence Review: ${selectedSessionId || ''}`}</h2>
                            <div className="right-panel-tabs">
                                <button 
                                    className={rightPanelView === 'feed' ? 'active' : ''}
                                    onClick={() => setRightPanelView('feed')}
                                >
                                    Live Feed
                                </button>
                                <button 
                                    className={rightPanelView === 'evidence' ? 'active' : ''}
                                    onClick={() => setRightPanelView('evidence')}
                                    disabled={!selectedSessionId}
                                >
                                    Evidence Timeline
                                </button>
                            </div>
                        </div>
                        {rightPanelView === 'feed' ? (
                            <AlertFeed violations={violations} />
                        ) : (
                            <EvidenceViewer sessionId={selectedSessionId} />
                        )}
                    </div>
                </main>
            )}
        </div>
    );
}
