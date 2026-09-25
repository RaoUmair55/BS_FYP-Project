import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';

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
        
        socketRef.current = io(serverUrl);
        const socket = socketRef.current;

        // Fetch recent initial violations so Live Feed is populated immediately
        const fetchInitialViolations = async () => {
            try {
                const res = await api.get('/violations');
                if (res.data && Array.isArray(res.data)) {
                    setViolations(res.data.slice(0, 50));
                }
            } catch (err) {
                // Silent fallback if unauthenticated or offline
            }
        };
        fetchInitialViolations();

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
            if (socket) {
                socket.disconnect();
            }
        };
    }, []);

    return { connected, violations, setViolations, riskScores, cameraVerifications, socket: socketRef.current };
}
