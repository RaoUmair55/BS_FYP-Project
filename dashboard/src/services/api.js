import axios from 'axios';
import {
    getInMemoryToken,
    getInMemoryMediaToken,
    refreshAccessTokenSingleFlight
} from '../context/AuthContext';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export const assetUrl = (url) => {
    if (!url || !url.includes('/uploads/')) return url;
    const address = new URL(url, baseURL);
    const mediaToken = getInMemoryMediaToken();
    if (mediaToken) {
        address.searchParams.set('token', mediaToken);
    }
    return address.toString();
};

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

// Response interceptor sharing the single-flight 401 refresh lock with AuthContext
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
            originalRequest._retry = true;
            const refreshed = await refreshAccessTokenSingleFlight();
            if (refreshed?.accessToken) {
                originalRequest.headers.Authorization = `Bearer ${refreshed.accessToken}`;
                return api(originalRequest);
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
