import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let gsiLoadPromise = null;

function loadGoogleIdentityScript() {
    if (window.google?.accounts?.id) {
        return Promise.resolve(window.google.accounts.id);
    }
    if (gsiLoadPromise) return gsiLoadPromise;

    gsiLoadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${GSI_SCRIPT_SRC}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(window.google?.accounts?.id), { once: true });
            existing.addEventListener('error', () => reject(new Error('Failed to load Google Sign-In script')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = GSI_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            if (window.google?.accounts?.id) {
                resolve(window.google.accounts.id);
            } else {
                reject(new Error('Google Identity Services unavailable'));
            }
        };
        script.onerror = () => {
            gsiLoadPromise = null;
            reject(new Error('Failed to load Google Sign-In script'));
        };
        document.head.appendChild(script);
    });

    return gsiLoadPromise;
}

export default function GoogleSignInButton({
    text = 'continue_with',
    disabled = false,
    onError,
    onSuccess,
    showDivider = true,
    dividerLabel = 'or'
}) {
    const { googleClientId, loginWithGoogle } = useAuth();
    const buttonHostRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!googleClientId || !buttonHostRef.current) return;
        let cancelled = false;

        loadGoogleIdentityScript()
            .then((gsi) => {
                if (cancelled || !gsi || !buttonHostRef.current) return;

                gsi.initialize({
                    client_id: googleClientId,
                    callback: async (response) => {
                        if (!response?.credential) {
                            onError?.('Google did not return a sign-in credential.');
                            return;
                        }
                        setBusy(true);
                        try {
                            const result = await loginWithGoogle(response.credential);
                            onSuccess?.(result);
                        } catch (err) {
                            onError?.(err.message || 'Google sign-in failed.');
                        } finally {
                            setBusy(false);
                        }
                    },
                    auto_select: false,
                    cancel_on_tap_outside: true
                });

                const isDark = document.documentElement.dataset.theme === 'dark';
                const hostWidth = Math.min(400, Math.max(240, buttonHostRef.current.clientWidth || 340));
                buttonHostRef.current.innerHTML = '';
                gsi.renderButton(buttonHostRef.current, {
                    type: 'standard',
                    theme: isDark ? 'filled_black' : 'outline',
                    size: 'large',
                    text,
                    shape: 'pill',
                    logo_alignment: 'left',
                    width: hostWidth
                });
                setReady(true);
            })
            .catch(() => {
                if (!cancelled) setReady(false);
            });

        return () => {
            cancelled = true;
        };
    }, [googleClientId, text, loginWithGoogle, onError, onSuccess]);

    if (!googleClientId) return null;

    return (
        <div style={{ width: '100%' }}>
            {showDivider && <div className="auth-divider">{dividerLabel}</div>}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: ready ? '44px' : '0px',
                    opacity: disabled || busy ? 0.6 : 1,
                    pointerEvents: disabled || busy ? 'none' : 'auto',
                    transition: 'opacity 0.15s ease'
                }}
            >
                <div ref={buttonHostRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }} />
            </div>
        </div>
    );
}
