import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { getInMemoryToken, subscribeTokenChange } from '../context/AuthContext';

export default function useSocket() {
    const [connected, setConnected] = useState(false);
    const [violations, setViolations] = useState([]);
    const [riskScores, setRiskScores] = useState({});
    const [cameraVerifications, setCameraVerifications] = useState({});
    
    // Use a ref to hold the socket instance across re-renders
    const socketRef = useRef(null);

    useEffect(() => {
        const serverUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        console.log(`Connecting to Socket.io server at ${serverUrl}`);
        
        socketRef.current = io(serverUrl, { 
            auth: (cb) => cb({ token: getInMemoryToken() }),
            autoConnect: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 2000
        });
        const socket = socketRef.current;

        // Fetch recent initial violations so Live Feed is populated immediately
        const fetchInitialViolations = async () => {
            try {
                const res = await api.get('/violations?active=true');
                if (res.data && Array.isArray(res.data)) {
                    setViolations(res.data.slice(0, 50));
                }
            } catch (err) {
                // Silent fallback if unauthenticated or offline
            }
        };
        fetchInitialViolations();

        // Subscribe to auth token updates to reconnect socket when teacher logs in / refreshes
        const unsubscribeToken = subscribeTokenChange((token) => {
            if (token) {
                socket.auth = { token };
                if (!socket.connected) {
                    socket.connect();
                }
                fetchInitialViolations();
            }
        });

        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            setConnected(true);
            fetchInitialViolations();
        });

        socket.on('disconnect', () => {
            console.log('Socket disconnected');
            setConnected(false);
        });

        socket.on('violation', (newViolation) => {
            setViolations((prev) => {
                const updated = [newViolation, ...prev];
                return updated.slice(0, 50);
            });
        });

        socket.on('violationReviewed', (reviewData) => {
            setViolations((prev) => 
                prev.map((v) => {
                    const id = String(v._id || v.id);
                    const targetId = String(reviewData.violationId);
                    if (id === targetId) {
                        return {
                            ...v,
                            reviewed: reviewData.reviewed,
                            decision: reviewData.decision,
                            reviewNote: reviewData.reviewNote,
                            reviewedAt: reviewData.reviewedAt
                        };
                    }
                    return v;
                })
            );
        });

        socket.on('riskScoreUpdate', (data) => {
            setRiskScores((prev) => ({
                ...prev,
                [data.sessionId]: data.riskScore
            }));
        });

        socket.on('cameraVerificationUpdated', (data) => {
            setCameraVerifications((prev) => ({
                ...prev,
                [data.sessionId]: data
            }));
        });

        // Cleanup on unmount
        return () => {
            unsubscribeToken();
            if (socket) {
                socket.disconnect();
            }
        };
    }, []);

    return { connected, violations, setViolations, riskScores, cameraVerifications, socket: socketRef.current };
}
