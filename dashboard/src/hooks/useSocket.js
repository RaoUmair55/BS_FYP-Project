import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

export default function useSocket() {
    const [connected, setConnected] = useState(false);
    const [violations, setViolations] = useState([]);
    const [riskScores, setRiskScores] = useState({});
    
    // Use a ref to hold the socket instance across re-renders
    const socketRef = useRef(null);

    useEffect(() => {
        const serverUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        console.log(`Connecting to Socket.io server at ${serverUrl}`);
        
        socketRef.current = io(serverUrl);
        const socket = socketRef.current;

        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            setConnected(true);
        });

        socket.on('disconnect', () => {
            console.log('Socket disconnected');
            setConnected(false);
        });

        socket.on('violation', (newViolation) => {
            setViolations((prev) => {
                // Keep the last 50, newest first
                const updated = [newViolation, ...prev];
                return updated.slice(0, 50);
            });
        });

        socket.on('riskScoreUpdate', (data) => {
            // data format: { sessionId, riskScore }
            setRiskScores((prev) => ({
                ...prev,
                [data.sessionId]: data.riskScore
            }));
        });

        // Cleanup on unmount
        return () => {
            if (socket) {
                socket.disconnect();
            }
        };
    }, []);

    return { connected, violations, riskScores };
}
