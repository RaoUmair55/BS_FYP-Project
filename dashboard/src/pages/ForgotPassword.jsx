import React, { useState } from 'react';
import { Shield, Mail, AlertCircle, CheckCircle, ArrowLeft, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

export default function ForgotPassword({ onNavigate }) {
    const { forgotPassword } = useAuth();
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');

        if (!email.trim() || !email.includes('@')) {
            setError('Please enter a valid email address');
            return;
        }

        setIsSubmitting(true);
        try {
            const data = await forgotPassword(email.trim().toLowerCase());
            setSuccessMessage(data.message || 'If an account with that email exists, a password reset link has been sent.');
        } catch (err) {
            setError(err.message || 'Failed to submit password reset request');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="auth-wrapper">
            <div className="auth-card">
                <div className="auth-brand">
                    <div className="auth-brand-logo">
                        <Shield size={26} />
                    </div>
                    <h1 className="auth-brand-title">Reset Password</h1>
                    <p className="auth-brand-subtitle">Enter your email to receive recovery instructions</p>
                </div>

                {error && (
                    <div className="auth-error-banner" style={{ marginBottom: 20 }}>
                        <AlertCircle size={18} style={{ flexShrink: 0 }} />
                        <span>{error}</span>
                    </div>
                )}

                {successMessage ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div className="auth-success-banner">
                            <CheckCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                            <div>
                                <strong>Request Received</strong>
                                <p style={{ margin: '4px 0 0 0', fontSize: 13, lineHeight: 1.4 }}>
                                    {successMessage}
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            className="auth-submit-btn"
                            onClick={() => onNavigate && onNavigate('login')}
                        >
                            <ArrowLeft size={16} />
                            <span>Return to Sign In</span>
                        </button>
                    </div>
                ) : (
                    <form className="auth-form" onSubmit={handleSubmit}>
                        <div className="auth-field-group">
                            <label className="auth-label" htmlFor="forgot-email">Account Email</label>
                            <div className="auth-input-container">
                                <Mail size={16} className="auth-input-icon" />
                                <input
                                    id="forgot-email"
                                    type="email"
                                    className="auth-input"
                                    placeholder="teacher@university.edu"
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        if (error) setError('');
                                    }}
                                    required
                                    autoComplete="email"
                                    disabled={isSubmitting}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="auth-submit-btn"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <span className="auth-spinner"></span>
                            ) : (
                                <>
                                    <span>Send Reset Link</span>
                                    <Send size={15} />
                                </>
                            )}
                        </button>

                        <div className="auth-footer-nav" style={{ marginTop: 16 }}>
                            <button
                                type="button"
                                className="auth-link"
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                onClick={() => onNavigate && onNavigate('login')}
                            >
                                <ArrowLeft size={14} />
                                <span>Back to Sign In</span>
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
