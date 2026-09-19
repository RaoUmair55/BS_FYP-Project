import React, { useState } from 'react';
import { Shield, X, AlertCircle, CheckCircle2, Circle, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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
        if (isSignUp && !name.trim()) {
            errors.name = 'Enter your first and last name';
        }

        if (!email.trim()) {
            errors.email = 'Enter an email address';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            errors.email = 'Enter a valid email address (e.g. name@university.edu)';
        }

        if (!password) {
            errors.password = 'Enter a password';
        } else if (isSignUp) {
            if (password.length < 8) {
                errors.password = 'Password must be at least 8 characters long';
            } else if (!hasNumber) {
                errors.password = 'Password must contain at least one number (0-9)';
            }
        }

        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (!validateForm()) {
            return;
        }

        setLoading(true);

        try {
            if (!isSignUp) {
                await login(email.trim(), password);
            } else {
                await signup(name.trim(), email.trim(), password);
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
                backgroundColor: '#ffffff',
                width: '100%',
                maxWidth: '448px',
                borderRadius: '28px',
                padding: '36px 40px',
                boxShadow: '0 4px 24px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(60, 64, 67, 0.2)',
                border: '1px solid #dadce0',
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
                            color: '#5f6368',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f3f4'}
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
                            <Shield size={22} color="#1a73e8" fill="rgba(26, 115, 232, 0.2)" strokeWidth={2.2} />
                        </div>
                        <span style={{ fontSize: '19px', fontWeight: 500, color: '#202124', letterSpacing: '-0.3px' }}>
                            IntegrityFlow
                        </span>
                    </div>

                    <h1 style={{
                        fontSize: '24px',
                        lineHeight: '32px',
                        fontWeight: 400,
                        color: '#202124',
                        margin: '0 0 6px 0'
                    }}>
                        {isSignUp ? 'Create an examiner account' : 'Sign in'}
                    </h1>
                    <p style={{
                        fontSize: '14px',
                        lineHeight: '20px',
                        color: '#5f6368',
                        margin: 0
                    }}>
                        {isSignUp ? 'Set up credentials to manage exams and proctoring' : 'to continue to IntegrityFlow Examiner Portal'}
                    </p>
                </div>

                {/* 1-Click Quick Demo Sign-in Button */}
                <button
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
                        backgroundColor: '#f8fafd',
                        border: '1px solid #c2e7ff',
                        borderRadius: '100px',
                        color: '#004a77',
                        fontSize: '14px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
                        marginBottom: '18px'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#eaf1fb';
                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#f8fafd';
                        e.currentTarget.style.boxShadow = 'none';
                    }}
                >
                    <Sparkles size={16} color="#1a73e8" />
                    <span>{loading ? 'Signing in...' : 'Sign in as Demo Examiner'}</span>
                </button>

                {/* Divider */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    margin: '16px 0 20px 0',
                    color: '#70757a',
                    fontSize: '13px'
                }}>
                    <div style={{ flex: 1, height: '1px', backgroundColor: '#dadce0' }} />
                    <span style={{ padding: '0 12px' }}>or</span>
                    <div style={{ flex: 1, height: '1px', backgroundColor: '#dadce0' }} />
                </div>

                {/* General Error Banner */}
                {error && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        padding: '12px 14px',
                        backgroundColor: '#fce8e6',
                        border: '1px solid #fad2cf',
                        borderRadius: '8px',
                        color: '#c5221f',
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
                                    color: '#202124',
                                    backgroundColor: '#ffffff',
                                    border: `1px solid ${fieldErrors.name ? '#d93025' : '#dadce0'}`,
                                    borderRadius: '4px',
                                    outline: 'none',
                                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                                }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = fieldErrors.name ? '#d93025' : '#1a73e8';
                                    e.currentTarget.style.boxShadow = `0 0 0 1px ${fieldErrors.name ? '#d93025' : '#1a73e8'}`;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = fieldErrors.name ? '#d93025' : '#dadce0';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            />
                            {fieldErrors.name && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: '#d93025', fontSize: '12px' }}>
                                    <AlertCircle size={13} />
                                    <span>{fieldErrors.name}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ marginBottom: '16px' }}>
                        <input
                            id="auth-email-input"
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
                                color: '#202124',
                                backgroundColor: '#ffffff',
                                border: `1px solid ${fieldErrors.email ? '#d93025' : '#dadce0'}`,
                                borderRadius: '4px',
                                outline: 'none',
                                transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                            }}
                            onFocus={(e) => {
                                e.currentTarget.style.borderColor = fieldErrors.email ? '#d93025' : '#1a73e8';
                                e.currentTarget.style.boxShadow = `0 0 0 1px ${fieldErrors.email ? '#d93025' : '#1a73e8'}`;
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = fieldErrors.email ? '#d93025' : '#dadce0';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        />
                        {fieldErrors.email && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: '#d93025', fontSize: '12px' }}>
                                <AlertCircle size={13} />
                                <span>{fieldErrors.email}</span>
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: isSignUp ? '14px' : '22px' }}>
                        <div style={{ position: 'relative' }}>
                            <input
                                id="auth-password-input"
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
                                    color: '#202124',
                                    backgroundColor: '#ffffff',
                                    border: `1px solid ${fieldErrors.password ? '#d93025' : '#dadce0'}`,
                                    borderRadius: '4px',
                                    outline: 'none',
                                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                                }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = fieldErrors.password ? '#d93025' : '#1a73e8';
                                    e.currentTarget.style.boxShadow = `0 0 0 1px ${fieldErrors.password ? '#d93025' : '#1a73e8'}`;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = fieldErrors.password ? '#d93025' : '#dadce0';
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
                                    color: '#5f6368',
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: '#d93025', fontSize: '12px' }}>
                                <AlertCircle size={13} />
                                <span>{fieldErrors.password}</span>
                            </div>
                        )}
                    </div>

                    {/* Real-time Password Requirements Checklist (for Sign Up) */}
                    {isSignUp && (
                        <div style={{
                            padding: '10px 12px',
                            backgroundColor: '#f8f9fa',
                            borderRadius: '6px',
                            marginBottom: '20px',
                            border: '1px solid #e8eaed'
                        }}>
                            <div style={{ fontSize: '12px', fontWeight: 500, color: '#5f6368', marginBottom: '6px' }}>
                                Password requirements:
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '12px',
                                    color: hasMinLength ? '#137333' : '#5f6368',
                                    fontWeight: hasMinLength ? 500 : 400
                                }}>
                                    {hasMinLength ? (
                                        <CheckCircle2 size={14} color="#137333" />
                                    ) : (
                                        <Circle size={12} color="#9aa0a6" />
                                    )}
                                    <span>At least 8 characters long</span>
                                </div>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '12px',
                                    color: hasNumber ? '#137333' : '#5f6368',
                                    fontWeight: hasNumber ? 500 : 400
                                }}>
                                    {hasNumber ? (
                                        <CheckCircle2 size={14} color="#137333" />
                                    ) : (
                                        <Circle size={12} color="#9aa0a6" />
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
                                color: '#1a73e8',
                                fontSize: '14px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                padding: '8px 10px',
                                borderRadius: '4px',
                                transition: 'background-color 0.15s ease'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(26, 115, 232, 0.08)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            {isSignUp ? 'Sign in instead' : 'Create account'}
                        </button>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                backgroundColor: '#1a73e8',
                                color: '#ffffff',
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
                            onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = '#1557d0')}
                            onMouseLeave={(e) => !loading && (e.currentTarget.style.backgroundColor = '#1a73e8')}
                        >
                            {loading ? 'Please wait...' : isSignUp ? 'Create' : 'Next'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
