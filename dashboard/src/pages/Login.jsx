import React, { useState } from 'react';
import { Shield, Mail, Lock, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';
import { validEmail } from '../utils/inputValidation';

export default function Login({ onNavigate }) {
    const { login, demoLogin } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDemoSubmitting, setIsDemoSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || isDemoSubmitting) return;
        setError('');

        if (!email.trim() || !password) {
            setError('Please enter both email and password');
            return;
        }
        if (!validEmail(email)) {
            setError('Enter a valid email address, for example teacher@university.edu');
            return;
        }

        setIsSubmitting(true);
        try {
            await login(email.trim().toLowerCase(), password);
            // On successful login, currentTeacher will update and App will route to Dashboard
        } catch (err) {
            setError(err.message || 'Invalid email or password');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDemoLogin = async (role = 'admin') => {
        setError('');
        setIsDemoSubmitting(role);
        try {
            await demoLogin(role);
        } catch (err) {
            setError(err.message || 'Failed to authenticate demo account');
        } finally {
            setIsDemoSubmitting(false);
        }
    };

    return (
        <div className="auth-wrapper">
            <div className="auth-card">
                <div className="auth-brand">
                    <div className="auth-brand-logo">
                        <Shield size={26} />
                    </div>
                    <h1 className="auth-brand-title">IntegrityFlow</h1>
                    <p className="auth-brand-subtitle">Examiner Portal Sign In</p>
                </div>

                {error && (
                    <div className="auth-error-banner" role="alert" style={{ marginBottom: 20 }}>
                        <AlertCircle size={18} style={{ flexShrink: 0 }} />
                        <span>{error}</span>
                    </div>
                )}

                <form className="auth-form" onSubmit={handleSubmit}>
                    <div className="auth-field-group">
                        <label className="auth-label" htmlFor="login-email">Email Address</label>
                        <div className="auth-input-container">
                            <Mail size={16} className="auth-input-icon" />
                            <input
                                id="login-email"
                                maxLength={254}
                                type="email"
                                className={`auth-input ${error ? 'has-error' : ''}`}
                                placeholder="teacher@university.edu"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    if (error) setError('');
                                }}
                                required
                                autoComplete="email"
                                disabled={isSubmitting || isDemoSubmitting}
                            />
                        </div>
                    </div>

                    <div className="auth-field-group">
                        <label className="auth-label" htmlFor="login-password">Password</label>
                        <div className="auth-input-container">
                            <Lock size={16} className="auth-input-icon" />
                            <input
                                id="login-password"
                                type="password"
                                className={`auth-input ${error ? 'has-error' : ''}`}
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    if (error) setError('');
                                }}
                                required
                                autoComplete="current-password"
                                disabled={isSubmitting || isDemoSubmitting}
                            />
                        </div>
                    </div>

                    <div className="auth-actions-row">
                        <button
                            type="button"
                            className="auth-link"
                            onClick={() => onNavigate && onNavigate('forgot-password')}
                            disabled={isSubmitting || isDemoSubmitting}
                        >
                            Forgot password?
                        </button>
                    </div>

                    <button
                        type="submit"
                        className="auth-submit-btn"
                        disabled={isSubmitting || isDemoSubmitting}
                    >
                        {isSubmitting ? (
                            <span className="auth-spinner"></span>
                        ) : (
                            <>
                                <span>Sign In</span>
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                </form>

                {/* Demo Sign-in: Enabled in development or when VITE_ENABLE_DEMO_LOGIN=true */}
                {import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true' && (
                    <>
                        <div className="auth-divider">or quick evaluation</div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <button
                                type="button"
                                className="auth-demo-btn"
                                onClick={() => handleDemoLogin('admin')}
                                disabled={isSubmitting || Boolean(isDemoSubmitting)}
                                style={{ margin: 0, justifyContent: 'center' }}
                            >
                                {isDemoSubmitting === 'admin' ? (
                                    <span className="auth-spinner dark" style={{ width: 14, height: 14, borderWidth: 2 }}></span>
                                ) : (
                                    <>
                                        <Shield size={14} style={{ color: 'var(--google-blue)' }} />
                                        <span>Demo Admin</span>
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                className="auth-demo-btn"
                                onClick={() => handleDemoLogin('teacher')}
                                disabled={isSubmitting || Boolean(isDemoSubmitting)}
                                style={{ margin: 0, justifyContent: 'center' }}
                            >
                                {isDemoSubmitting === 'teacher' ? (
                                    <span className="auth-spinner dark" style={{ width: 14, height: 14, borderWidth: 2 }}></span>
                                ) : (
                                    <>
                                        <Sparkles size={14} style={{ color: '#10b981' }} />
                                        <span>Demo Teacher</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </>
                )}

                <div className="auth-footer-nav">
                    <span>Don't have an account?</span>
                    <button
                        type="button"
                        className="auth-link"
                        onClick={() => onNavigate && onNavigate('signup')}
                    >
                        Sign Up
                    </button>
                </div>
            </div>
        </div>
    );
}
