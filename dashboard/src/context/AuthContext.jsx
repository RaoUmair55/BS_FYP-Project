import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AuthContext = createContext(null);
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// In-memory token holder accessible to outside modules (e.g. axios api.js)
let inMemoryAccessToken = null;
let tokenChangeListeners = [];

export function getInMemoryToken() {
    return inMemoryAccessToken;
}

export function setInMemoryToken(token) {
    inMemoryAccessToken = token;
    tokenChangeListeners.forEach(listener => listener(token));
}

export function subscribeTokenChange(listener) {
    tokenChangeListeners.push(listener);
    return () => {
        tokenChangeListeners = tokenChangeListeners.filter(l => l !== listener);
    };
}

export function AuthProvider({ children }) {
    // Current in-memory authentication state (NEVER stored in localStorage or sessionStorage)
    const [currentTeacher, setCurrentTeacher] = useState(null);
    const [accessToken, setAccessTokenState] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const updateAccessToken = useCallback((token) => {
        setInMemoryToken(token);
        setAccessTokenState(token);
    }, []);

    // Helper to fetch current teacher details with a given access token
    const fetchTeacherProfile = async (token) => {
        try {
            const res = await fetch(`${API_BASE}/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include'
            });

            if (res.ok) {
                const data = await res.json();
                return data.teacher;
            }
            return null;
        } catch (err) {
            console.warn('[AuthContext] Failed to fetch teacher profile:', err);
            return null;
        }
    };

    // Silent refresh on initial app load
    useEffect(() => {
        let isMounted = true;

        const checkSilentAuth = async () => {
            try {
                // Attempt to rotate/refresh using the httpOnly cookie
                const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
                    method: 'POST',
                    credentials: 'include'
                });

                if (refreshRes.ok) {
                    const data = await refreshRes.json();
                    if (data.accessToken && isMounted) {
                        updateAccessToken(data.accessToken);

                        // Fetch teacher profile using the fresh in-memory access token
                        const teacherProfile = await fetchTeacherProfile(data.accessToken);
                        if (teacherProfile && isMounted) {
                            setCurrentTeacher(teacherProfile);
                        }
                    }
                } else {
                    // No valid refresh session
                    if (isMounted) {
                        updateAccessToken(null);
                        setCurrentTeacher(null);
                    }
                }
            } catch (err) {
                console.warn('[AuthContext] Silent auth check warning:', err);
                if (isMounted) {
                    updateAccessToken(null);
                    setCurrentTeacher(null);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        checkSilentAuth();

        return () => {
            isMounted = false;
        };
    }, [updateAccessToken]);

    // Log In action
    const login = async (email, password) => {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();
        if (!res.ok) {
            let errorMessage = data.error || 'Invalid email or password';
            if (data.details) {
                if (Array.isArray(data.details)) {
                    errorMessage = data.details.join(', ');
                } else if (typeof data.details === 'string') {
                    errorMessage = data.details;
                }
            }
            throw new Error(errorMessage);
        }

        updateAccessToken(data.accessToken);
        setCurrentTeacher(data.teacher);
        return data.teacher;
    };

    // Sign Up action
    const signup = async (name, email, password, role = 'teacher') => {
        const res = await fetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, email, password, role })
        });

        const data = await res.json();
        if (!res.ok) {
            let errorMessage = data.error || 'Registration failed';
            if (data.details) {
                if (Array.isArray(data.details)) {
                    errorMessage = data.details.join(', ');
                } else if (typeof data.details === 'string') {
                    errorMessage = data.details;
                }
            }
            throw new Error(errorMessage);
        }

        updateAccessToken(data.accessToken);
        setCurrentTeacher(data.teacher);
        return data.teacher;
    };

    // Forgot Password action
    const forgotPassword = async (email) => {
        const res = await fetch(`${API_BASE}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to process password reset request');
        }
        return data;
    };

    // Reset Password action
    const resetPassword = async (token, newPassword) => {
        const res = await fetch(`${API_BASE}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ token, newPassword })
        });

        const data = await res.json();
        if (!res.ok) {
            let errorMessage = data.error || 'Failed to reset password';
            if (data.details) {
                if (Array.isArray(data.details)) {
                    errorMessage = data.details.join(', ');
                } else if (typeof data.details === 'string') {
                    errorMessage = data.details;
                }
            }
            throw new Error(errorMessage);
        }
        return data;
    };

    // 1-Click Quick Demo Login for testing/examiners/admins
    const demoLogin = async (role = 'admin') => {
        const demoEmail = role === 'admin' ? 'admin@integrityflow.edu' : 'proctor@integrityflow.edu';
        const demoPassword = 'Password123!';
        const demoName = role === 'admin' ? 'Super Administrator' : 'Dr. Integrity Examiner';

        try {
            return await login(demoEmail, demoPassword);
        } catch (err) {
            // Auto register demo user with specified role if not in DB yet
            return await signup(demoName, demoEmail, demoPassword, role);
        }
    };

    // Log Out action
    const logout = async () => {
        try {
            await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });
        } catch (e) {
            console.warn('[AuthContext] Logout request error:', e);
        } finally {
            updateAccessToken(null);
            setCurrentTeacher(null);
        }
    };

    // Authenticated fetch wrapper with automatic silent refresh retry on 401
    const authFetch = async (url, options = {}) => {
        let token = inMemoryAccessToken;

        const headers = { ...(options.headers || {}) };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        let res = await fetch(url, { ...options, headers, credentials: 'include' });

        // If access token expired or rejected, attempt silent refresh once
        if (res.status === 401) {
            try {
                const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
                    method: 'POST',
                    credentials: 'include'
                });

                if (refreshRes.ok) {
                    const refreshData = await refreshRes.json();
                    updateAccessToken(refreshData.accessToken);

                    // Retry original request with newly issued in-memory access token
                    headers['Authorization'] = `Bearer ${refreshData.accessToken}`;
                    res = await fetch(url, { ...options, headers, credentials: 'include' });
                } else {
                    // Session expired completely
                    logout();
                }
            } catch (refreshErr) {
                logout();
            }
        }

        return res;
    };

    return (
        <AuthContext.Provider
            value={{
                accessToken,
                currentTeacher,
                teacher: currentTeacher, // Backwards-compatible alias
                isLoading,
                loading: isLoading,      // Backwards-compatible alias
                login,
                signup,
                logout,
                forgotPassword,
                resetPassword,
                demoLogin,
                authFetch
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
