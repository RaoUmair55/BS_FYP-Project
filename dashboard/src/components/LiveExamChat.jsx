import React, { useState, useEffect, useRef } from 'react';
import { 
    MessageSquare, Send, Bell, Users, Megaphone, Check, 
    X, User, Clock, AlertCircle, Sparkles, MessageCircle, ChevronDown 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import notify from '../utils/notify';
import ModalPortal from './ModalPortal';
import './Components.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function LiveExamChat({ 
    isOpen, 
    onClose, 
    examId: initialExamId, 
    activeExams = [],
    initialSessionId, 
    activeSessions = [], 
    socket, 
    isInline = false 
}) {
    const { authFetch, teacher } = useAuth();
    const resolveFallbackExamId = () => {
        if (initialExamId) return initialExamId;
        if (initialSessionId) {
            const match = activeSessions.find(s => String(s.sessionId || s._id) === String(initialSessionId));
            if (match?.examId) return match.examId;
        }
        return activeExams[0]?.examCode || activeExams[0]?.examId || activeSessions[0]?.examId || '';
    };

    const [selectedExamId, setSelectedExamId] = useState(resolveFallbackExamId);
    const [messages, setMessages] = useState([]);
    const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId || 'ALL');
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef(null);

    // Sync incoming examId prop or automatically pick the active exam when unfiltered ("All Live Exams")
    useEffect(() => {
        if (initialExamId) {
            setSelectedExamId(initialExamId);
            return;
        }
        const validCodes = new Set([
            ...activeExams.map(e => String(e.examCode || e.examId || '').toUpperCase()),
            ...activeSessions.map(s => String(s.examId || '').toUpperCase())
        ].filter(Boolean));

        if (!selectedExamId || (validCodes.size > 0 && !validCodes.has(String(selectedExamId).toUpperCase()))) {
            const fallback = resolveFallbackExamId();
            if (fallback) setSelectedExamId(fallback);
        }
    }, [initialExamId, activeExams, activeSessions, initialSessionId]);

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
            } else {
                const errData = await res.json().catch(() => ({}));
                notify.error('Message Failed', errData.error || 'Could not send chat message.');
            }
        } catch (err) {
            console.error('Failed to send message:', err);
            notify.error('Message Failed', err.message || 'Network error while sending message.');
        } finally {
            setSending(false);
        }
    };

    const markThreadAsRead = (sid) => {
        const unread = messages.filter(m => m.sessionId === sid && m.sender === 'student' && !m.read);
        if (unread.length === 0) return;
        setMessages(prev => prev.map(m => (m.sessionId === sid && m.sender === 'student' ? { ...m, read: true } : m)));
        unread.forEach(m => {
            const id = m._id || m.id;
            if (id) authFetch(`${API_BASE_URL}/messages/${id}/read`, { method: 'PATCH' }).catch(() => {});
        });
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

    // Merge active sessions (scoped to selectedExamId) that haven't sent a message yet
    activeSessions.forEach(s => {
        if (selectedExamId && s.examId && String(s.examId).toUpperCase() !== String(selectedExamId).toUpperCase()) {
            return;
        }
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

    const examOptions = Array.from(new Set([
        ...activeExams.map(e => e.examCode || e.examId).filter(Boolean),
        ...activeSessions.map(s => s.examId).filter(Boolean),
        ...(selectedExamId ? [selectedExamId] : [])
    ]));

    const activeThread = selectedSessionId !== 'ALL' ? candidateThreads[selectedSessionId] : null;

    // Filter displayed messages based on selected thread
    const displayedMessages = messages.filter(m => {
        if (selectedSessionId === 'ALL') {
            return true; // Show full live stream + broadcasts
        }
        return m.sessionId === selectedSessionId || m.isBroadcast;
    });

    const innerChatContent = (
        <div className="live-chat-shell">
            {/* Left Sidebar: Channels List */}
            <div className="live-chat-sidebar">
                <div className="live-chat-sidebar-header">
                    <span>CHANNELS</span>
                    <span className="badge" style={{ fontSize: '10px' }}>{Object.keys(candidateThreads).length + 1} Channels</span>
                </div>

                {!initialExamId && examOptions.length > 1 && (
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-color)' }}>
                        <select
                            value={selectedExamId}
                            onChange={(e) => { setSelectedExamId(e.target.value); setSelectedSessionId('ALL'); }}
                            style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '11.5px', fontWeight: 600 }}
                        >
                            {examOptions.map(code => (
                                <option key={code} value={code}>{code}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="live-chat-channel-list">
                    {/* Broadcast All Channel */}
                    <div 
                        onClick={() => setSelectedSessionId('ALL')}
                        style={{
                            padding: '9px 12px',
                            borderRadius: '8px',
                            marginBottom: '4px',
                            cursor: 'pointer',
                            background: selectedSessionId === 'ALL' ? 'var(--primary-soft)' : 'transparent',
                            border: selectedSessionId === 'ALL' ? '1.5px solid var(--primary)' : '1.5px solid transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s ease'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary-soft)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Megaphone size={14} />
                            </div>
                            <div>
                                <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)' }}>
                                    All Candidates
                                </div>
                                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
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
                                onClick={() => { setSelectedSessionId(th.sessionId); markThreadAsRead(th.sessionId); }}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    marginBottom: '4px',
                                    cursor: 'pointer',
                                    background: isSelected ? 'var(--primary-soft)' : 'transparent',
                                    border: isSelected ? '1.5px solid var(--primary)' : '1.5px solid transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-muted)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <User size={14} />
                                    </div>
                                    <div style={{ overflow: 'hidden' }}>
                                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {th.studentName}
                                        </div>
                                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {th.rollNumber ? `Roll: ${th.rollNumber}` : 'Candidate'}
                                        </div>
                                    </div>
                                </div>

                                {th.unreadCount > 0 && (
                                    <span style={{ background: 'var(--danger-bg)', color: 'var(--text-on-color)', fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '10px', flexShrink: 0 }}>
                                        {th.unreadCount}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Right Area: Active Message Conversation */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'transparent', minHeight: 0, overflow: 'hidden' }}>
                {/* Channel Header Banner */}
                <div style={{ padding: '10px 16px', background: 'rgba(255, 255, 255, 0.25)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {selectedSessionId === 'ALL' ? (
                            <>
                                <Megaphone size={16} style={{ color: 'var(--primary)' }} />
                                <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                                    Exam-Wide Broadcast & Clarifications
                                </span>
                            </>
                        ) : (
                            <>
                                <MessageCircle size={16} style={{ color: 'var(--primary)' }} />
                                <div>
                                    <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                                        Direct Thread: {activeThread?.studentName || 'Candidate'}
                                    </span>
                                    {activeThread?.rollNumber && (
                                        <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                                            (Roll: {activeThread.rollNumber})
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Exam Scope: <strong style={{ color: 'var(--text-main)' }}>{selectedExamId || 'None'}</strong>
                    </div>
                </div>

                {/* Messages List Area */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
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
                                    <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <strong>{msg.senderName} {msg.rollNumber ? `(${msg.rollNumber})` : ''}</strong>
                                        {isBroadcast && (
                                            <span style={{ background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: '9px', padding: '1px 4px', borderRadius: '3px', fontWeight: 600 }}>
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
                                        background: isBroadcast ? 'var(--warning-soft)' : isTeacher ? 'var(--primary-bg)' : 'var(--bg-surface)',
                                        color: isBroadcast ? 'var(--warning)' : isTeacher ? 'var(--text-on-color)' : 'var(--text-main)',
                                        border: isBroadcast ? '1px solid var(--warning-soft)' : isTeacher ? 'none' : '1px solid var(--border-color)',
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
                <form onSubmit={handleSendMessage} style={{ padding: '10px 14px', background: 'var(--bg-surface)', borderTop: '1px solid var(--bg-muted)', display: 'flex', gap: '8px', alignItems: 'center' }}>
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
            <div style={{ flex: 1, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden' }}>
                {innerChatContent}
            </div>
        );
    }

    return (
        <ModalPortal>
        <div 
            className="md-modal-overlay" 
            style={{ zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                <div style={{ padding: '12px 18px', background: 'var(--primary-bg)', color: 'var(--text-on-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                            color: 'var(--text-on-color)', 
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
        </ModalPortal>
    );
}
