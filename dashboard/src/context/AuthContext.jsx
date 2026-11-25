import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// In-memory token holders accessible to outside modules (e.g. axios api.js)
// NEVER persisted to localStorage or sessionStorage.
let inMemoryAccessToken = null;
let inMemoryMediaToken = null;
let tokenChangeListeners = [];
let activeRefreshPromise = null;

export function getInMemoryToken() {
    return inMemoryAccessToken;
}

export function getInMemoryMediaToken() {
    return inMemoryMediaToken;
}

export function setInMemoryTokens(accessToken, mediaToken = null) {
    inMemoryAccessToken = accessToken || null;
    inMemoryMediaToken = accessToken ? (mediaToken ?? inMemoryMediaToken) : null;
    tokenChangeListeners.forEach(listener => listener(inMemoryAccessToken, inMemoryMediaToken));
}

export function setInMemoryToken(token) {
    setInMemoryTokens(token, token ? inMemoryMediaToken : null);
}

export function subscribeTokenChange(listener) {
    tokenChangeListeners.push(listener);
    return () => {
        tokenChangeListeners = tokenChangeListeners.filter(l => l !== listener);
    };
}

/**
 * Single-flight refresh lock shared across AuthContext (silent init + authFetch)
 * and axios api.js interceptors so concurrent 401 responses never rotate/revoke
 * each other's refresh token cookie.
 */
export async function refreshAccessTokenSingleFlight() {
    if (activeRefreshPromise) {
        return activeRefreshPromise;
    }

    activeRefreshPromise = (async () => {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!refreshRes.ok) {
            setInMemoryTokens(null, null);
            return null;
        }
        const data = await refreshRes.json();
        if (!data?.accessToken) {
            setInMemoryTokens(null, null);
            return null;
        }
        setInMemoryTokens(data.accessToken, data.mediaToken || null);
        return data;
    })()
        .catch(() => {
            setInMemoryTokens(null, null);
            return null;
        })
        .finally(() => {
            activeRefreshPromise = null;
        });

    return activeRefreshPromise;
}

export function AuthProvider({ children }) {
    const [currentTeacher, setCurrentTeacher] = useState(null);
    const [accessToken, setAccessTokenState] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [googleClientId, setGoogleClientId] = useState(() => (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim() || null);

    // Discover server-configured auth providers (e.g., Google OAuth client ID) once on mount
    useEffect(() => {
        if (googleClientId) return;
        let active = true;
        fetch(`${API_BASE}/auth/providers`)
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (active && data?.googleEnabled && data.googleClientId) {
                    setGoogleClientId(data.googleClientId);
                }
            })
            .catch(() => {});
        return () => { active = false; };
    }, [googleClientId]);

    const updateAccessToken = useCallback((token, mediaToken = null) => {
        setInMemoryTokens(token, mediaToken);
        setAccessTokenState(token || null);
    }, []);

    // Keep React state synced when axios interceptor refreshes or clears the token
    useEffect(() => {
        return subscribeTokenChange((nextToken) => {
            setAccessTokenState(nextToken || null);
            if (!nextToken) {
                setCurrentTeacher(null);
            }
        });
    }, []);

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

    // Silent refresh on initial app load (uses shared single-flight lock)
    useEffect(() => {
        let isMounted = true;

        const checkSilentAuth = async () => {
            try {
                const data = await refreshAccessTokenSingleFlight();
                if (data?.accessToken && isMounted) {
                    setAccessTokenState(data.accessToken);
                    const teacherProfile = await fetchTeacherProfile(data.accessToken);
                    if (teacherProfile && isMounted) {
                        setCurrentTeacher(teacherProfile);
                    }
                } else if (isMounted) {
                    setAccessTokenState(null);
                    setCurrentTeacher(null);
                }
            } catch (err) {
                console.warn('[AuthContext] Silent auth check warning:', err);
                if (isMounted) {
                    updateAccessToken(null, null);
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

        updateAccessToken(data.accessToken, data.mediaToken || null);
        setCurrentTeacher(data.teacher);
        return data.teacher;
    };

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

        if (data.verificationRequired) return data;
        updateAccessToken(data.accessToken, data.mediaToken || null);
        setCurrentTeacher(data.teacher);
        return data.teacher;
    };

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

    const loginWithGoogle = async (credential) => {
        const res = await fetch(`${API_BASE}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ credential })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Google sign-in failed');
        }

        updateAccessToken(data.accessToken, data.mediaToken || null);
        setCurrentTeacher(data.teacher);
        return data;
    };

    const demoLogin = async (role = 'admin') => {
        const demoEmail = role === 'admin' ? import.meta.env.VITE_DEMO_ADMIN_EMAIL : import.meta.env.VITE_DEMO_TEACHER_EMAIL;
        const demoPassword = role === 'admin' ? import.meta.env.VITE_DEMO_ADMIN_PASSWORD : import.meta.env.VITE_DEMO_TEACHER_PASSWORD;
        if (import.meta.env.VITE_ENABLE_DEMO_LOGIN !== 'true' || !demoEmail || !demoPassword) throw new Error('Demo login is not configured');
        return login(demoEmail, demoPassword);
    };

    const logout = async () => {
        try {
            await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });
        } catch (e) {
            console.warn('[AuthContext] Logout request error:', e);
        } finally {
            updateAccessToken(null, null);
            setCurrentTeacher(null);
        }
    };

    // Authenticated fetch wrapper using the shared single-flight refresh lock on 401
    const authFetch = async (url, options = {}) => {
        const token = inMemoryAccessToken;

        const headers = { ...(options.headers || {}) };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        let res = await fetch(url, { ...options, headers, credentials: 'include' });

        if (res.status === 401) {
            const refreshed = await refreshAccessTokenSingleFlight();
            if (refreshed?.accessToken) {
                headers['Authorization'] = `Bearer ${refreshed.accessToken}`;
                res = await fetch(url, { ...options, headers, credentials: 'include' });
            } else {
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
                teacher: currentTeacher,
                isLoading,
                loading: isLoading,
                showAuthModal,
                setShowAuthModal,
                login,
                loginWithGoogle,
                googleClientId,
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
