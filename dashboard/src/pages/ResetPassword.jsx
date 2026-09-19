import React, { useState, useEffect } from 'react';
import { Shield, Lock, AlertCircle, CheckCircle, ArrowRight, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

export default function ResetPassword({ token: propToken, onNavigate }) {
    const { resetPassword } = useAuth();
    const [token, setToken] = useState(propToken || '');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Extract token from URL query string if not provided via props
    useEffect(() => {
        if (!token) {
            const urlParams = new URLSearchParams(window.location.search);
            const queryToken = urlParams.get('token');
            if (queryToken) {
                setToken(queryToken);
            }
        }
    }, [token]);

    const hasMinLength = newPassword.length >= 8;
    const hasNumber = /\d/.test(newPassword);
    const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');

        if (!token) {
            setError('Missing password reset token. Please request a new password reset link.');
            return;
        }

        if (!hasMinLength) {
            setError('Password must be at least 8 characters long');
            return;
        }

        if (!hasNumber) {
            setError('Password must contain at least one number');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setIsSubmitting(true);
        try {
            const data = await resetPassword(token, newPassword);
            setSuccessMessage(data.message || 'Password has been successfully reset. Please log in with your new password.');
        } catch (err) {
            setError(err.message || 'Failed to reset password');
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
                    <h1 className="auth-brand-title">Create New Password</h1>
                    <p className="auth-brand-subtitle">Enter your new secure password below</p>
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
                                <strong>Password Reset Complete!</strong>
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
                            <span>Proceed to Sign In</span>
                            <ArrowRight size={16} />
                        </button>
                    </div>
                ) : (
                    <form className="auth-form" onSubmit={handleSubmit}>
                        {!token && (
                            <div className="auth-error-banner" style={{ marginBottom: 12 }}>
                                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                                <span>No reset token detected in URL. Please check your reset link.</span>
                            </div>
                        )}

                        <div className="auth-field-group">
                            <label className="auth-label" htmlFor="reset-new-password">New Password</label>
                            <div className="auth-input-container">
                                <Lock size={16} className="auth-input-icon" />
                                <input
                                    id="reset-new-password"
                                    type="password"
                                    className="auth-input"
                                    placeholder="Min. 8 chars with 1 number"
                                    value={newPassword}
                                    onChange={(e) => {
                                        setNewPassword(e.target.value);
                                        if (error) setError('');
                                    }}
                                    required
                                    autoComplete="new-password"
                                    disabled={isSubmitting || !token}
                                />
                            </div>
                            {newPassword.length > 0 && (
                                <div className="auth-validation-hints">
                                    <span className={`auth-hint-item ${hasMinLength ? 'valid' : ''}`}>
                                        <Check size={12} />
                                        <span>At least 8 characters</span>
                                    </span>
                                    <span className={`auth-hint-item ${hasNumber ? 'valid' : ''}`}>
                                        <Check size={12} />
                                        <span>At least 1 number</span>
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="auth-field-group">
                            <label className="auth-label" htmlFor="reset-confirm-password">Confirm New Password</label>
                            <div className="auth-input-container">
                                <Lock size={16} className="auth-input-icon" />
                                <input
                                    id="reset-confirm-password"
                                    type="password"
                                    className="auth-input"
                                    placeholder="Re-type new password"
                                    value={confirmPassword}
                                    onChange={(e) => {
                                        setConfirmPassword(e.target.value);
                                        if (error) setError('');
                                    }}
                                    required
                                    autoComplete="new-password"
                                    disabled={isSubmitting || !token}
                                />
                            </div>
                            {confirmPassword.length > 0 && (
                                <div className="auth-validation-hints">
                                    <span className={`auth-hint-item ${passwordsMatch ? 'valid' : ''}`}>
                                        <Check size={12} />
                                        <span>Passwords match</span>
                                    </span>
                                </div>
                            )}
                        </div>

                        <button
                            type="submit"
                            className="auth-submit-btn"
                            disabled={isSubmitting || !token}
                        >
                            {isSubmitting ? (
                                <span className="auth-spinner"></span>
                            ) : (
                                <>
                                    <span>Reset Password</span>
                                    <ArrowRight size={16} />
                                </>
                            )}
                        </button>

                        <div className="auth-footer-nav" style={{ marginTop: 16 }}>
                            <button
                                type="button"
                                className="auth-link"
                                onClick={() => onNavigate && onNavigate('login')}
                            >
                                Back to Sign In
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
