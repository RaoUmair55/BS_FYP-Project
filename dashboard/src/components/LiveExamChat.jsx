import React, { useState, useEffect, useRef } from 'react';
import { 
    MessageSquare, Send, Bell, Users, Megaphone, Check, 
    X, User, Clock, AlertCircle, Sparkles, MessageCircle, ChevronDown 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Components.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function LiveExamChat({ 
    isOpen, 
    onClose, 
    examId: initialExamId, 
    initialSessionId, 
    activeSessions = [], 
    socket, 
    isInline = false 
}) {
    const { authFetch, teacher } = useAuth();
    const [selectedExamId, setSelectedExamId] = useState(initialExamId || '');
    const [messages, setMessages] = useState([]);
    const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId || 'ALL');
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef(null);

    // Sync incoming examId prop
    useEffect(() => {
        if (initialExamId) {
            setSelectedExamId(initialExamId);
        }
    }, [initialExamId]);

    // Sync initialSessionId prop when switching directly to a candidate channel
    useEffect(() => {
        if (initialSessionId) {
            setSelectedSessionId(initialSessionId);
        } else if (!selectedSessionId) {
            setSelectedSessionId('ALL');
        }
    }, [initialSessionId]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const fetchMessages = async () => {
        if (!selectedExamId) {
            setMessages([]);
            return;
        }
        setLoading(true);
        try {
            const res = await authFetch(`${API_BASE_URL}/exams/${selectedExamId}/messages`);
            if (res.ok) {
                const data = await res.json();
                setMessages(data.messages || data || []);
            }
        } catch (err) {
            console.error('Failed to fetch messages:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedExamId) {
            fetchMessages();
        }
    }, [selectedExamId]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, selectedSessionId]);

    // Listen for real-time incoming messages / announcements over WebSocket
    useEffect(() => {
        if (!socket) return;

        const handleNewMessage = (newMsg) => {
            if (newMsg.examId?.toUpperCase() === selectedExamId?.toUpperCase()) {
                setMessages(prev => {
                    const newId = (newMsg._id || newMsg.id)?.toString();
                    if (newId && prev.some(m => (m._id || m.id)?.toString() === newId)) {
                        return prev;
                    }
                    return [...prev, newMsg];
                });
            }
        };

        socket.on('chatMessage', handleNewMessage);
        socket.on('examAnnouncement', handleNewMessage);

        return () => {
            socket.off('chatMessage', handleNewMessage);
            socket.off('examAnnouncement', handleNewMessage);
        };
    }, [socket, selectedExamId]);

    if (!isInline && !isOpen) {
        return null;
    }

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputText.trim() || !selectedExamId) return;

        setSending(true);
        const isBroadcastMode = selectedSessionId === 'ALL';

        try {
            const res = await authFetch(`${API_BASE_URL}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: isBroadcastMode ? 'ALL' : selectedSessionId,
                    examId: selectedExamId,
                    sender: 'teacher',
                    senderName: teacher?.name ? `Prof. ${teacher.name}` : 'Examiner',
                    text: inputText.trim(),
                    isBroadcast: isBroadcastMode
                })
            });

            if (res.ok) {
                const data = await res.json();
                const savedMsg = data.message || data;
                setMessages(prev => {
                    const savedId = (savedMsg._id || savedMsg.id)?.toString();
                    if (savedId && prev.some(m => (m._id || m.id)?.toString() === savedId)) {
                        return prev;
                    }
                    return [...prev, savedMsg];
                });
                setInputText('');
            }
        } catch (err) {
            console.error('Failed to send message:', err);
        } finally {
            setSending(false);
        }
    };

    // Group messages by candidate session thread
    const candidateThreads = {};
    messages.forEach(m => {
        if (!m.isBroadcast && m.sessionId && m.sessionId !== 'ALL') {
            if (!candidateThreads[m.sessionId]) {
                candidateThreads[m.sessionId] = {
                    sessionId: m.sessionId,
                    studentName: m.senderName,
                    rollNumber: m.rollNumber,
                    messages: [],
                    unreadCount: 0
                };
            }
            candidateThreads[m.sessionId].messages.push(m);
            if (m.sender === 'student' && !m.read) {
                candidateThreads[m.sessionId].unreadCount++;
            }
        }
    });

    // Merge active sessions that haven't sent a message yet
    activeSessions.forEach(s => {
        const sid = s.sessionId || s._id;
        if (sid && !candidateThreads[sid]) {
            candidateThreads[sid] = {
                sessionId: sid,
                studentName: s.studentName || s.studentId || 'Candidate',
                rollNumber: s.rollNumber || '',
                messages: [],
                unreadCount: 0
            };
        }
    });

    const activeThread = selectedSessionId !== 'ALL' ? candidateThreads[selectedSessionId] : null;

    // Filter displayed messages based on selected thread
    const displayedMessages = messages.filter(m => {
        if (selectedSessionId === 'ALL') {
            return true; // Show full live stream + broadcasts
        }
        return m.sessionId === selectedSessionId || m.isBroadcast;
    });

    const innerChatContent = (
        <div style={{ display: 'flex', flex: 1, width: '100%', height: '100%', minHeight: isInline ? '480px' : 'auto', overflow: 'hidden', background: '#f8fafc' }}>
            {/* Left Sidebar: Channels List */}
            <div style={{ width: '260px', borderRight: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '11.5px', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>CHANNELS</span>
                    <span className="badge" style={{ fontSize: '10px' }}>{Object.keys(candidateThreads).length + 1} Channels</span>
                </div>

                <div style={{ overflowY: 'auto', flex: 1, padding: '6px' }}>
                    {/* Broadcast All Channel */}
                    <div 
                        onClick={() => setSelectedSessionId('ALL')}
                        style={{
                            padding: '9px 12px',
                            borderRadius: '8px',
                            marginBottom: '4px',
                            cursor: 'pointer',
                            background: selectedSessionId === 'ALL' ? '#eff6ff' : 'transparent',
                            border: selectedSessionId === 'ALL' ? '1.5px solid #3b82f6' : '1.5px solid transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s ease'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#dbeafe', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Megaphone size={14} />
                            </div>
                            <div>
                                <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1e293b' }}>
                                    📢 All Candidates
                                </div>
                                <div style={{ fontSize: '10.5px', color: '#64748b' }}>
                                    Broadcast announcements
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Candidate Individual Direct Channels */}
                    {Object.values(candidateThreads).map(th => {
                        const isSelected = selectedSessionId === th.sessionId;

                        return (
                            <div 
                                key={th.sessionId}
                                onClick={() => setSelectedSessionId(th.sessionId)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    marginBottom: '4px',
                                    cursor: 'pointer',
                                    background: isSelected ? '#eff6ff' : 'transparent',
                                    border: isSelected ? '1.5px solid #3b82f6' : '1.5px solid transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f1f5f9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <User size={14} />
                                    </div>
                                    <div style={{ overflow: 'hidden' }}>
                                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {th.studentName}
                                        </div>
                                        <div style={{ fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {th.rollNumber ? `Roll: ${th.rollNumber}` : 'Candidate'}
                                        </div>
                                    </div>
                                </div>

                                {th.unreadCount > 0 && (
                                    <span style={{ background: '#ef4444', color: '#ffffff', fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '10px', flexShrink: 0 }}>
                                        {th.unreadCount}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Right Area: Active Message Conversation */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
                {/* Channel Header Banner */}
                <div style={{ padding: '10px 16px', background: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {selectedSessionId === 'ALL' ? (
                            <>
                                <Megaphone size={16} style={{ color: '#2563eb' }} />
                                <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#1e293b' }}>
                                    Exam-Wide Broadcast & Clarifications
                                </span>
                            </>
                        ) : (
                            <>
                                <MessageCircle size={16} style={{ color: '#2563eb' }} />
                                <div>
                                    <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#1e293b' }}>
                                        Direct Thread: {activeThread?.studentName || 'Candidate'}
                                    </span>
                                    {activeThread?.rollNumber && (
                                        <span style={{ fontSize: '11.5px', color: '#64748b', marginLeft: '6px' }}>
                                            (Roll: {activeThread.rollNumber})
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Exam Scope: <strong style={{ color: '#1e293b' }}>{selectedExamId || 'None'}</strong>
                    </div>
                </div>

                {/* Messages List Area */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', margin: 'auto', fontSize: '13px' }}>
                            Loading messages...
                        </div>
                    ) : displayedMessages.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', margin: 'auto', padding: '20px' }}>
                            <MessageSquare size={32} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                            <div style={{ fontSize: '13.5px', fontWeight: 500 }}>No messages yet in this channel.</div>
                            <div style={{ fontSize: '11.5px', marginTop: '4px' }}>
                                {selectedSessionId === 'ALL' 
                                    ? 'Post an exam announcement below or wait for student paper inquiries.'
                                    : 'Send a direct guidance reply to this candidate below.'}
                            </div>
                        </div>
                    ) : (
                        displayedMessages.map((msg, idx) => {
                            const isTeacher = msg.sender === 'teacher';
                            const isBroadcast = msg.isBroadcast;

                            return (
                                <div 
                                    key={msg._id || idx}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: isTeacher ? 'flex-end' : 'flex-start',
                                        maxWidth: '82%',
                                        alignSelf: isTeacher ? 'flex-end' : 'flex-start'
                                    }}
                                >
                                    <div style={{ fontSize: '10.5px', color: '#64748b', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <strong>{msg.senderName} {msg.rollNumber ? `(${msg.rollNumber})` : ''}</strong>
                                        {isBroadcast && (
                                            <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '9px', padding: '1px 4px', borderRadius: '3px', fontWeight: 600 }}>
                                                ANNOUNCEMENT
                                            </span>
                                        )}
                                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>

                                    <div style={{
                                        padding: '9px 13px',
                                        borderRadius: '10px',
                                        fontSize: '13px',
                                        lineHeight: 1.4,
                                        background: isBroadcast ? '#fef3c7' : isTeacher ? '#2563eb' : '#ffffff',
                                        color: isBroadcast ? '#78350f' : isTeacher ? '#ffffff' : '#1e293b',
                                        border: isBroadcast ? '1px solid #fde68a' : isTeacher ? 'none' : '1px solid #e2e8f0',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                                    }}>
                                        {msg.text}
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Message Input Box */}
                <form onSubmit={handleSendMessage} style={{ padding: '10px 14px', background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input 
                        type="text"
                        className="md-input"
                        placeholder={selectedSessionId === 'ALL' 
                            ? "Broadcast announcement to all candidates in this exam..." 
                            : `Direct reply to ${activeThread?.studentName || 'candidate'}...`}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        style={{ flex: 1, padding: '8px 12px', fontSize: '13px', borderRadius: '6px' }}
                    />

                    <button 
                        type="submit" 
                        className="md-btn md-btn-primary" 
                        disabled={sending || !inputText.trim()}
                        style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px' }}
                    >
                        <Send size={14} />
                        <span>{selectedSessionId === 'ALL' ? 'Broadcast' : 'Send'}</span>
                    </button>
                </form>
            </div>
        </div>
    );

    if (isInline) {
        return (
            <div style={{ height: 'calc(100vh - 210px)', minHeight: '480px', display: 'flex', flexDirection: 'column', background: '#ffffff', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                {innerChatContent}
            </div>
        );
    }

    return (
        <div 
            className="md-modal-overlay" 
            style={{ zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => {
                if (e.target === e.currentTarget && onClose) {
                    onClose();
                }
            }}
        >
            <div 
                className="md-modal-card" 
                style={{ maxWidth: '860px', width: '90%', height: '75vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ padding: '12px 18px', background: '#1a73e8', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <MessageSquare size={18} />
                        <div>
                            <div style={{ fontSize: '14.5px', fontWeight: 600 }}>
                                Live Exam Chat &mdash; {selectedExamId || 'Exam'}
                            </div>
                            <div style={{ fontSize: '11px', opacity: 0.9 }}>
                                Paper clarifications, candidate inquiries & announcements
                            </div>
                        </div>
                    </div>
                    <button 
                        type="button"
                        onClick={onClose}
                        title="Close Chat Window"
                        style={{ 
                            background: 'rgba(255,255,255,0.2)', 
                            border: 'none', 
                            color: '#ffffff', 
                            cursor: 'pointer', 
                            padding: '5px', 
                            borderRadius: '4px', 
                            display: 'flex', 
                            alignItems: 'center'
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {innerChatContent}
            </div>
        </div>
    );
}
