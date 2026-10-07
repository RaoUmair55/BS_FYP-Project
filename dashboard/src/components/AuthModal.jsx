import React, { useState } from 'react';
import { Shield, X, AlertCircle, CheckCircle2, Circle, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { NAME_PATTERN, validName, validEmail, validPasswordSize } from '../utils/inputValidation';

export default function AuthModal({ isOpen, onClose }) {
    const { login, signup, demoLogin } = useAuth();
    const [isSignUp, setIsSignUp] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    // Password requirement calculations for real-time feedback
    const hasMinLength = password.length >= 8;
    const hasNumber = /\d/.test(password);

    const validateForm = () => {
        const errors = {};
        if (isSignUp && !validName(name)) {
            errors.name = 'Use 2-100 characters and at least two letters; letters, spaces, apostrophes, periods and hyphens are allowed.';
        }

        if (!email.trim()) {
            errors.email = 'Enter an email address';
        } else if (!validEmail(email)) {
            errors.email = 'Enter a valid email address';
        }

        if (!password) {
            errors.password = 'Enter a password';
        } else if (isSignUp) {
            if (password.length < 8) {
                errors.password = 'Password must be at least 8 characters long';
            } else if (!hasNumber) {
                errors.password = 'Password must contain at least one number (0-9)';
            } else if (!validPasswordSize(password)) {
                errors.password = 'Password must be no longer than 72 UTF-8 bytes';
            }
        }

        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (loading) return;
        setError(null);

        if (!validateForm()) {
            return;
        }

        setLoading(true);

        try {
            if (!isSignUp) {
                await login(email.trim(), password);
            } else {
                const result = await signup(name.trim(), email.trim(), password);
                if (result.verificationRequired) setError(result.message);
            }
        } catch (err) {
            const msg = err.message || 'Authentication failed. Please check your credentials.';
            setError(msg);

            // Highlight specific field if message matches
            const lower = msg.toLowerCase();
            if (lower.includes('email') || lower.includes('already registered')) {
                setFieldErrors(prev => ({ ...prev, email: msg }));
            } else if (lower.includes('password') || lower.includes('number') || lower.includes('8 characters')) {
                setFieldErrors(prev => ({ ...prev, password: msg }));
            }
        } finally {
            setLoading(false);
        }
    };

    const handleQuickDemoLogin = async () => {
        setError(null);
        setFieldErrors({});
        setLoading(true);
        try {
            await demoLogin();
        } catch (err) {
            setError(err.message || 'Couldn\'t initialize demo session.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(32, 33, 36, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
            fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        }}>
            {/* Google Material 3 Design Card */}
            <div style={{
                backgroundColor: 'var(--bg-surface)',
                width: '100%',
                maxWidth: '448px',
                borderRadius: '28px',
                padding: '36px 40px',
                boxShadow: '0 4px 24px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(60, 64, 67, 0.2)',
                border: '1px solid var(--border-color)',
                position: 'relative',
                boxSizing: 'border-box',
                animation: 'googleModalFadeIn 0.2s cubic-bezier(0, 0, 0.2, 1)'
            }}>
                {/* Close Button */}
                {onClose && (
                    <button
                        onClick={onClose}
                        title="Close"
                        style={{
                            position: 'absolute',
                            top: '18px',
                            right: '18px',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: '50%',
                            width: '36px',
                            height: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-muted)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        <X size={20} />
                    </button>
                )}

                {/* IntegrityFlow Brand Header */}
                <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                        <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            backgroundColor: 'rgba(26, 115, 232, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <Shield size={22} color="var(--primary)" fill="rgba(26, 115, 232, 0.2)" strokeWidth={2.2} />
                        </div>
                        <span style={{ fontSize: '19px', fontWeight: 500, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
                            IntegrityFlow
                        </span>
                    </div>

                    <h1 style={{
                        fontSize: '24px',
                        lineHeight: '32px',
                        fontWeight: 400,
                        color: 'var(--text-main)',
                        margin: '0 0 6px 0'
                    }}>
                        {isSignUp ? 'Create an examiner account' : 'Sign in'}
                    </h1>
                    <p style={{
                        fontSize: '14px',
                        lineHeight: '20px',
                        color: 'var(--text-muted)',
                        margin: 0
                    }}>
                        {isSignUp ? 'Set up credentials to manage exams and proctoring' : 'to continue to IntegrityFlow Examiner Portal'}
                    </p>
                </div>

                {/* 1-Click Quick Demo Sign-in Button */}
                {import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true' && <button
                    type="button"
                    onClick={handleQuickDemoLogin}
                    disabled={loading}
                    style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        padding: '10px 16px',
                        backgroundColor: 'var(--bg-base)',
                        border: '1px solid var(--primary-soft)',
                        borderRadius: '100px',
                        color: 'var(--primary)',
                        fontSize: '14px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
                        marginBottom: '18px'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--primary-soft)';
                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-base)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}
                >
                    <Sparkles size={16} color="var(--primary)" />
                    <span>{loading ? 'Signing in...' : 'Sign in as Demo Examiner'}</span>
                </button>}

                {/* Divider */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    margin: '16px 0 20px 0',
                    color: 'var(--text-muted)',
                    fontSize: '13px'
                }}>
                    <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
                    <span style={{ padding: '0 12px' }}>or</span>
                    <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
                </div>

                {/* General Error Banner */}
                {error && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        padding: '12px 14px',
                        backgroundColor: 'var(--danger-soft)',
                        border: '1px solid var(--danger-soft)',
                        borderRadius: '8px',
                        color: 'var(--danger)',
                        fontSize: '13px',
                        marginBottom: '18px',
                        lineHeight: '18px'
                    }}>
                        <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                        <span>{error}</span>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} noValidate>
                    {isSignUp && (
                        <div style={{ marginBottom: '16px' }}>
                            <input
                                id="auth-name-input"
                                required
                                minLength={2}
                                maxLength={100}
                                pattern={NAME_PATTERN}
                                title="Use 2-100 characters and at least two letters."
                                type="text"
                                placeholder="Full name"
                                value={name}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    if (fieldErrors.name) setFieldErrors(prev => ({ ...prev, name: null }));
                                }}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '13px 15px',
                                    fontSize: '14px',
                                    color: 'var(--text-main)',
                                    backgroundColor: 'var(--bg-surface)',
                                    border: `1px solid ${fieldErrors.name ? 'var(--danger)' : 'var(--border-color)'}`,
                                    borderRadius: '4px',
                                    outline: 'none',
                                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                                }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = fieldErrors.name ? 'var(--danger)' : 'var(--primary)';
                                    e.currentTarget.style.boxShadow = `0 0 0 1px ${fieldErrors.name ? '#d93025' : '#1a73e8'}`;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = fieldErrors.name ? 'var(--danger)' : 'var(--border-color)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            />
                            {fieldErrors.name && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: 'var(--danger)', fontSize: '12px' }}>
                                    <AlertCircle size={13} />
                                    <span>{fieldErrors.name}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ marginBottom: '16px' }}>
                        <input
                            id="auth-email-input"
                            required
                            maxLength={254}
                            type="email"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: null }));
                            }}
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '13px 15px',
                                fontSize: '14px',
                                color: 'var(--text-main)',
                                backgroundColor: 'var(--bg-surface)',
                                border: `1px solid ${fieldErrors.email ? 'var(--danger)' : 'var(--border-color)'}`,
                                borderRadius: '4px',
                                outline: 'none',
                                transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                            }}
                            onFocus={(e) => {
                                e.currentTarget.style.borderColor = fieldErrors.email ? 'var(--danger)' : 'var(--primary)';
                                e.currentTarget.style.boxShadow = `0 0 0 1px ${fieldErrors.email ? '#d93025' : '#1a73e8'}`;
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = fieldErrors.email ? 'var(--danger)' : 'var(--border-color)';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        />
                        {fieldErrors.email && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: 'var(--danger)', fontSize: '12px' }}>
                                <AlertCircle size={13} />
                                <span>{fieldErrors.email}</span>
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: isSignUp ? '14px' : '22px' }}>
                        <div style={{ position: 'relative' }}>
                            <input
                                id="auth-password-input"
                                required
                                minLength={isSignUp ? 8 : undefined}
                                maxLength={isSignUp ? 72 : undefined}
                                type={showPassword ? 'text' : 'password'}
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: null }));
                                }}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '13px 44px 13px 15px',
                                    fontSize: '14px',
                                    color: 'var(--text-main)',
                                    backgroundColor: 'var(--bg-surface)',
                                    border: `1px solid ${fieldErrors.password ? 'var(--danger)' : 'var(--border-color)'}`,
                                    borderRadius: '4px',
                                    outline: 'none',
                                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                                }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = fieldErrors.password ? 'var(--danger)' : 'var(--primary)';
                                    e.currentTarget.style.boxShadow = `0 0 0 1px ${fieldErrors.password ? '#d93025' : '#1a73e8'}`;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = fieldErrors.password ? 'var(--danger)' : 'var(--border-color)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                title={showPassword ? 'Hide password' : 'Show password'}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>

                        {fieldErrors.password && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: 'var(--danger)', fontSize: '12px' }}>
                                <AlertCircle size={13} />
                                <span>{fieldErrors.password}</span>
                            </div>
                        )}
                    </div>

                    {/* Real-time Password Requirements Checklist (for Sign Up) */}
                    {isSignUp && (
                        <div style={{
                            padding: '10px 12px',
                            backgroundColor: 'var(--bg-base)',
                            borderRadius: '6px',
                            marginBottom: '20px',
                            border: '1px solid var(--border-color)'
                        }}>
                            <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '6px' }}>
                                Password requirements:
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '12px',
                                    color: hasMinLength ? 'var(--success)' : 'var(--text-muted)',
                                    fontWeight: hasMinLength ? 500 : 400
                                }}>
                                    {hasMinLength ? (
                                        <CheckCircle2 size={14} color="var(--success)" />
                                    ) : (
                                        <Circle size={12} color="var(--text-muted)" />
                                    )}
                                    <span>At least 8 characters long</span>
                                </div>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '12px',
                                    color: hasNumber ? 'var(--success)' : 'var(--text-muted)',
                                    fontWeight: hasNumber ? 500 : 400
                                }}>
                                    {hasNumber ? (
                                        <CheckCircle2 size={14} color="var(--success)" />
                                    ) : (
                                        <Circle size={12} color="var(--text-muted)" />
                                    )}
                                    <span>At least one number (0-9)</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Action Bar */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: '8px'
                    }}>
                        <button
                            type="button"
                            onClick={() => {
                                setIsSignUp(!isSignUp);
                                setError(null);
                                setFieldErrors({});
                            }}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--primary)',
                                fontSize: '14px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                padding: '8px 10px',
                                borderRadius: '4px',
                                transition: 'background-color 0.15s ease'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--primary-soft)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            {isSignUp ? 'Sign in instead' : 'Create account'}
                        </button>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                backgroundColor: 'var(--primary-bg)',
                                color: 'var(--text-on-color)',
                                border: 'none',
                                borderRadius: '100px',
                                padding: '10px 24px',
                                fontSize: '14px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
                                boxShadow: '0 1px 2px rgba(60,64,67,0.3)',
                                opacity: loading ? 0.7 : 1
                            }}
                            onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = 'var(--primary-hover)')}
                            onMouseLeave={(e) => !loading && (e.currentTarget.style.backgroundColor = 'var(--primary-bg)')}
                        >
                            {loading ? 'Please wait...' : isSignUp ? 'Create' : 'Next'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
