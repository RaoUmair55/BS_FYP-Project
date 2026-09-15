import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000'
});

export const getActiveSessions = () => api.get('/sessions/active');
export const getViolations = (sessionId) => api.get(`/violations/${sessionId}`);
export const uploadPaper = (examId, file) => {
    const formData = new FormData();
    formData.append('paper', file);
    return api.post(`/exam/${examId}/paper`, formData);
};
export const getRiskScore = (sessionId) => api.get(`/risk-score/${sessionId}`);
export const getExams = () => api.get('/exam');

export default api;
