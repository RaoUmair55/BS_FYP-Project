import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { validEmail } from '../utils/inputValidation';
import './Auth.css';

export default function VerifyEmail({ onNavigate }) {
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [verified, setVerified] = useState(false);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        if (!token) return;
        let active = true;
        setBusy(true);
        api.post('/verification/confirm', { submittedValue: token, teacherId: params.get('teacherId') || undefined })
            .then(() => { if (active) { setVerified(true); setMessage('Email verified. You can now sign in.'); window.history.replaceState({}, '', '/verify-email'); } })
            .catch(err => { if (active) setError(err.response?.data?.error || 'Unable to verify email. Please try again or request a new link.'); })
            .finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, []);
    const resend = async event => {
        event.preventDefault();
        if (busy) return;
        setError(''); setMessage('');
        if (!validEmail(email)) { setError('Enter a valid email address.'); return; }
        setBusy(true);
        try {
            await api.post('/verification/send', { email: email.trim().toLowerCase() });
            setMessage('Verification email sent. Open the link within one hour.');
        } catch (err) { setError(err.response?.data?.error || 'Unable to send email. Please try again.'); }
        finally { setBusy(false); }
    };
    return <div className="auth-wrapper"><div className="auth-card">
        <div className="auth-brand"><h1 className="auth-brand-title">Verify your email</h1><p className="auth-brand-subtitle">Confirm your examiner account before signing in.</p></div>
        {busy && <p role="status">Please wait…</p>}
        {error && <div className="auth-error-banner" role="alert">{error}</div>}
        {message && <div className="auth-success-banner" role="status">{message}</div>}
        {!verified && <form className="auth-form" onSubmit={resend}>
            <label className="auth-label" htmlFor="verification-email">Account email</label>
            <input id="verification-email" className="auth-input" type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} />
            <button className="auth-submit-btn" disabled={busy}>Resend verification email</button>
        </form>}
        <div className="auth-footer-nav"><button className="auth-link" onClick={() => onNavigate('login')}>Back to sign in</button></div>
    </div></div>;
}
