import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { Shield, Moon, Sun } from 'lucide-react';
import './App.css';
import './pages/Auth.css';

function getInitialPage() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const queryPage = params.get('page');

    if (queryPage) return queryPage.toLowerCase();
    if (path === 'signup') return 'signup';
    if (path === 'forgot-password') return 'forgot-password';
    if (path === 'reset-password' || params.has('token')) return 'reset-password';
    if (path === 'login') return 'login';
    return 'dashboard';
}

function MainRouter() {
    const { currentTeacher, isLoading } = useAuth();
    const [currentPage, setCurrentPage] = useState(getInitialPage);
    const [theme, setTheme] = useState(() => localStorage.getItem('integrityflow-theme') === 'dark' ? 'dark' : 'light');
    const [resetToken, setResetToken] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('token') || '';
    });

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        localStorage.setItem('integrityflow-theme', theme);
    }, [theme]);

    // Listen to browser Back/Forward navigation
    useEffect(() => {
        const handlePopState = () => {
            const page = getInitialPage();
            setCurrentPage(page);
            const params = new URLSearchParams(window.location.search);
            if (params.get('token')) {
                setResetToken(params.get('token'));
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const navigateTo = (page, params = {}) => {
        setCurrentPage(page);
        let newUrl = `/${page === 'dashboard' || page === 'login' ? '' : page}`;
        if (params.token) {
            setResetToken(params.token);
            newUrl += `?token=${encodeURIComponent(params.token)}`;
        }
        window.history.pushState({}, '', newUrl || '/');
    };

    // 1. Initial Silent Auth Loading State: Show clean progress spinner
    if (isLoading) {
        return (
            <div className="auth-loading-screen">
                <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, var(--primary-bg), #4285f4)',
                    color: 'var(--text-on-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(26, 115, 232, 0.3)',
                    marginBottom: 8
                }}>
                    <Shield size={24} />
                </div>
                <div className="auth-spinner dark"></div>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
                    Authenticating session...
                </span>
            </div>
        );
    }

    // 2. Unauthenticated: Only Login, Signup, ForgotPassword, and ResetPassword are reachable
    if (!currentTeacher) {
        let authPage;
        switch (currentPage) {
            case 'signup':
                authPage = <Signup onNavigate={navigateTo} />;
                break;
            case 'forgot-password':
                authPage = <ForgotPassword onNavigate={navigateTo} />;
                break;
            case 'reset-password':
                authPage = <ResetPassword token={resetToken} onNavigate={navigateTo} />;
                break;
            case 'login':
            default:
                authPage = <Login onNavigate={navigateTo} />;
        }
        return (
            <div className="auth-theme-shell">
                <button className="auth-theme-toggle" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
                    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                {authPage}
            </div>
        );
    }

    // 3. Authenticated: Render Main Examiner Dashboard
    return (
        <div className="app">
            <Dashboard theme={theme} onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} />
        </div>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <MainRouter />
        </AuthProvider>
    );
}
