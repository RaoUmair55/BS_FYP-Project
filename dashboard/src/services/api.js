import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:3000' });

export const getActiveSessions = () => api.get('/sessions/active');
export const getViolations = (sessionId) => api.get(`/violations/${sessionId}`);
export const uploadPaper = (examId, file) => api.post(`/exam/${examId}/paper`, file);

export default api;
