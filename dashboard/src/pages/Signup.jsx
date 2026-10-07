import React, { useState } from 'react';
import { Shield, User, Mail, Lock, AlertCircle, CheckCircle, ArrowRight, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';
import { NAME_PATTERN, validName, validEmail, validPasswordSize } from '../utils/inputValidation';

export default function Signup({ onNavigate }) {
    const { signup } = useAuth();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [signupSuccess, setSignupSuccess] = useState(false);
    const [verificationMessage, setVerificationMessage] = useState('');

    // Client-side validation checks
    const hasMinLength = password.length >= 8;
    const hasNumber = /\d/.test(password);
    const passwordsMatch = password.length > 0 && password === confirmPassword;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || signupSuccess) return;
        setError('');

        if (!validName(name)) {
            setError('Full name must contain 2-100 characters and at least two letters. Use letters, spaces, apostrophes, periods or hyphens.');
            return;
        }

        if (!validEmail(email)) {
            setError('Please enter a valid email address');
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
        if (!validPasswordSize(password)) {
            setError('Password is too long. Use no more than 72 UTF-8 bytes.');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await signup(name.trim(), email.trim().toLowerCase(), password);
            if (result.verificationRequired) setVerificationMessage(result.message);
            setSignupSuccess(true);
            // After signup, AuthContext has access token & teacher, App routes automatically to dashboard
        } catch (err) {
            setError(err.message || 'Registration failed');
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
                    <h1 className="auth-brand-title">IntegrityFlow</h1>
                    <p className="auth-brand-subtitle">Create Examiner Account</p>
                </div>

                {error && (
                    <div className="auth-error-banner" role="alert" style={{ marginBottom: 20 }}>
                        <AlertCircle size={18} style={{ flexShrink: 0 }} />
                        <span>{error}</span>
                    </div>
                )}

                {signupSuccess && (
                    <div className="auth-success-banner" style={{ marginBottom: 20 }}>
                        <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                        <div>
                            <strong>Account Created!</strong>
                            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>{verificationMessage || 'Redirecting to your Examiner Dashboard...'}</p>
                            {verificationMessage && <button type="button" className="auth-link" onClick={() => onNavigate('verify-email')}>Resend verification email</button>}
                        </div>
                    </div>
                )}

                <form className="auth-form" onSubmit={handleSubmit}>
                    <div className="auth-field-group">
                        <label className="auth-label" htmlFor="signup-name">Full Name</label>
                        <div className="auth-input-container">
                            <User size={16} className="auth-input-icon" />
                            <input
                                id="signup-name"
                                minLength={2}
                                maxLength={100}
                                pattern={NAME_PATTERN}
                                title="Use 2-100 characters with at least two letters. Letters, spaces, apostrophes, periods and hyphens are allowed."
                                autoComplete="name"
                                type="text"
                                className="auth-input"
                                placeholder="Professor Jane Doe"
                                value={name}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    if (error) setError('');
                                }}
                                required
                                disabled={isSubmitting || signupSuccess}
                            />
                        </div>
                    </div>

                    <div className="auth-field-group">
                        <label className="auth-label" htmlFor="signup-email">Work Email</label>
                        <div className="auth-input-container">
                            <Mail size={16} className="auth-input-icon" />
                            <input
                                id="signup-email"
                                maxLength={254}
                                type="email"
                                className="auth-input"
                                placeholder="jane.doe@university.edu"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    if (error) setError('');
                                }}
                                required
                                autoComplete="email"
                                disabled={isSubmitting || signupSuccess}
                            />
                        </div>
                    </div>

                    <div className="auth-field-group">
                        <label className="auth-label" htmlFor="signup-password">Password</label>
                        <div className="auth-input-container">
                            <Lock size={16} className="auth-input-icon" />
                            <input
                                id="signup-password"
                                minLength={8}
                                maxLength={72}
                                pattern=".*[0-9].*"
                                title="Use at least 8 characters and one number."
                                type="password"
                                className="auth-input"
                                placeholder="Min. 8 chars with 1 number"
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    if (error) setError('');
                                }}
                                required
                                autoComplete="new-password"
                                disabled={isSubmitting || signupSuccess}
                            />
                        </div>
                        {password.length > 0 && (
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
                        <label className="auth-label" htmlFor="signup-confirm-password">Confirm Password</label>
                        <div className="auth-input-container">
                            <Lock size={16} className="auth-input-icon" />
                            <input
                                id="signup-confirm-password"
                                maxLength={72}
                                type="password"
                                className="auth-input"
                                placeholder="Re-type password"
                                value={confirmPassword}
                                onChange={(e) => {
                                    setConfirmPassword(e.target.value);
                                    e.target.setCustomValidity('');
                                    if (error) setError('');
                                }}
                                required
                                autoComplete="new-password"
                                disabled={isSubmitting || signupSuccess}
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
                        disabled={isSubmitting || signupSuccess}
                    >
                        {isSubmitting ? (
                            <span className="auth-spinner"></span>
                        ) : (
                            <>
                                <span>Create Account</span>
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                </form>

                <div className="auth-footer-nav">
                    <span>Already have an account?</span>
                    <button
                        type="button"
                        className="auth-link"
                        onClick={() => onNavigate && onNavigate('login')}
                    >
                        Sign In
                    </button>
                </div>
            </div>
        </div>
    );
}
