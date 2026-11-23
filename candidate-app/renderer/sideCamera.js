/* Side-camera setup uses only the configured HTTPS backend; there is no phone-to-laptop connection. */
window.IntegritySideCamera = (() => {
    let socket;
    async function pair(info) {
        const response = await fetch(`${info.serverUrl}/pairing/create`, { method: 'POST',
            headers: { Authorization: `Bearer ${info.sessionToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: info.sessionId }), signal: AbortSignal.timeout(15000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Cannot create pairing code');
        return result;
    }
    async function connect(info, onStatus) {
        const base = new URL(info.serverUrl);
        if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') throw new Error('Side camera requires SERVER_URL to be the public HTTPS backend address.');
        if (!info.sessionToken) throw new Error('Session credential missing. Return to exam entry.');
        if (!window.io) await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${base.origin}/socket.io/socket.io.js`; script.onload = resolve;
            script.onerror = () => reject(new Error('Cannot load the backend connection client. Check internet access.'));
            document.head.append(script);
        });
        socket?.disconnect();
        socket = window.io(base.origin, { auth: { token: info.sessionToken, scope: 'candidate_session' }, reconnection: true });
        let lastStatusAt = Date.now();
        socket.on('side-camera-status', state => { lastStatusAt = Date.now(); onStatus(state); });
        const staleTimer = setInterval(() => {
            if (Date.now() - lastStatusAt > 25000) onStatus({ status: 'lost', placementVerified: false });
        }, 2000);
        socket.on('disconnect', () => onStatus({ status: 'lost', placementVerified: false }));
        socket.on('connect_error', () => onStatus({ status: 'lost', placementVerified: false }));
        window.addEventListener('pagehide', () => { clearInterval(staleTimer); socket.disconnect(); }, { once: true });
        return socket;
    }
    async function setup(info, onReady) {
        if (!info.requireSecondaryCamera) return;
        const section = document.getElementById('check-side-camera'); section.hidden = false;
        const status = document.getElementById('side-camera-setup-status');
        const preview = document.getElementById('side-camera-preview');
        const criteria = document.getElementById('side-camera-criteria');
        const qr = document.getElementById('side-camera-qr');
        const button = document.getElementById('side-camera-pair');
        const labels = { person: 'Person fully in frame', workstation: 'Laptop or keyboard visible', lighting: 'Enough light', steady: 'Landscape and steady' };
        onReady(false);
        try {
            const connection = await connect(info, state => {
                const ready = state.status === 'verified' && state.placementVerified;
                onReady(ready);
                status.textContent = ready ? 'Verified · ready to begin' : state.status === 'connected' ? 'Phone connected · checking placement' :
                    state.status === 'lost' ? 'Connection lost · keep the phone page open and restore internet' : 'Waiting for phone';
                if (ready || state.status === 'lost') { preview.removeAttribute('src'); preview.hidden = true; }
            });
            connection.on('preview-frame', data => {
                if (data.sessionId !== info.sessionId || typeof data.frame !== 'string' || !data.frame.startsWith('data:image/jpeg;base64,')) return;
                preview.src = data.frame; preview.hidden = false;
            });
            const tips = {
                person: { pass: '✅ Head & upper body visible from side', fail: '❌ Adjust angle/distance: Keep your head & side profile in frame' },
                workstation: { pass: '✅ Laptop & keyboard visible on desk', fail: '❌ Angle toward desk: Keep laptop, keyboard & hands visible' },
                lighting: { pass: '✅ Good lighting on desk', fail: '❌ Too dark: Increase lighting around your desk' },
                steady: { pass: '✅ Steady on books/stand in landscape', fail: '❌ Rest phone steadily on books/stand in landscape mode' }
            };
            connection.on('placement-result', data => {
                criteria.replaceChildren();
                for (const [key, ok] of Object.entries(data.criteria || {})) {
                    const item = document.createElement('li');
                    item.style.cssText = ok 
                        ? 'background:#dcfce7;color:#15803d;padding:8px 12px;border-radius:8px;margin-bottom:6px;font-weight:600;font-size:13px;border:1px solid #86efac;list-style:none;'
                        : 'background:#ffedd5;color:#c2410c;padding:8px 12px;border-radius:8px;margin-bottom:6px;font-weight:600;font-size:13px;border:1px solid #fed7aa;list-style:none;';
                    item.textContent = tips[key] ? (ok ? tips[key].pass : tips[key].fail) : `${ok ? 'Pass' : 'Adjust'} · ${labels[key] || key}`;
                    criteria.append(item);
                }
                if (data.verified) { preview.removeAttribute('src'); preview.hidden = true; }
            });
            const create = async () => {
                button.disabled = true;
                try {
                    const result = await pair(info);
                    qr.src = result.qrImage; qr.hidden = false;
                    document.getElementById('side-camera-expiry').textContent = 'Scan within 5 minutes. Open the link on your phone, follow the instructions and tap Start.';
                } catch (error) { status.textContent = error.message; }
                finally { button.disabled = false; }
            };
            button.addEventListener('click', create); await create();
        } catch (error) { status.textContent = error.message; }
    }
    async function monitor(info) {
        if (!info.requireSecondaryCamera) return;
        const badge = document.createElement('span'); badge.id = 'side-camera-live-status'; badge.setAttribute('role', 'status');
        badge.style.cssText = 'font-size:13px;padding:7px 10px;border-radius:8px;background:#e8f4ef;color:#174e42';
        document.getElementById('monitoringBadge')?.after(badge);
        const repair = document.createElement('details'); repair.hidden = true; repair.id = 'side-camera-repair';
        const summary = document.createElement('summary'); summary.textContent = 'Reconnect phone';
        const explanation = document.createElement('p'); explanation.textContent = 'If you closed the phone tab, generate and scan a new code, then verify placement again. Your exam stays open.';
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Generate reconnect QR code';
        const qr = document.createElement('img'); qr.alt = 'Scan to reconnect the side camera'; qr.width = 220; qr.height = 220; qr.hidden = true;
        repair.append(summary, explanation, button, qr); badge.after(repair);
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { const result = await pair(info); qr.src = result.qrImage; qr.hidden = false; }
            catch (error) { explanation.textContent = error.message; }
            finally { button.disabled = false; }
        });
        try {
            await connect(info, state => {
                repair.hidden = state.status === 'verified';
                if (repair.hidden) { qr.hidden = true; qr.removeAttribute('src'); }
                badge.textContent = state.status === 'lost' ? 'Side camera disconnected. Keep its page open and restore the connection.' : `Side camera: ${state.status.replace('_', ' ')}`;
                badge.style.background = state.status === 'lost' ? '#fff2cf' : '#e8f4ef';
            });
        } catch (error) { badge.textContent = error.message; }
    }
    return { setup, monitor };
})();
