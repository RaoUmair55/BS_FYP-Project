import axios from 'axios';
import { getInMemoryToken, setInMemoryToken } from '../context/AuthContext';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({
    baseURL,
    withCredentials: true
});

// Request interceptor to attach in-memory JWT access token
api.interceptors.request.use((config) => {
    const token = getInMemoryToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    config.withCredentials = true;
    return config;
});

// Response interceptor to handle token refresh on 401
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;
            try {
                const refreshRes = await axios.post(
                    `${baseURL}/auth/refresh`,
                    {},
                    { withCredentials: true }
                );
                
                if (refreshRes.data?.accessToken) {
                    const newToken = refreshRes.data.accessToken;
                    setInMemoryToken(newToken);
                    originalRequest.headers.Authorization = `Bearer ${newToken}`;
                    return api(originalRequest);
                }
            } catch (refreshErr) {
                // Refresh token invalid or expired — clear in-memory auth state
                setInMemoryToken(null);
            }
        }
        return Promise.reject(error);
    }
);

export const getActiveSessions = () => api.get('/sessions/active');
export const getViolations = (sessionId) => api.get(`/violations/${sessionId}`);
export const uploadPaper = (examId, file) => {
    const formData = new FormData();
    formData.append('paper', file);
    return api.post(`/exam/${examId}/paper`, formData);
};
export const getRiskScore = (sessionId) => api.get(`/risk-score/${sessionId}`);
export const getExams = () => api.get('/exams');

export default api;
