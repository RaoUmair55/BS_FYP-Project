document.addEventListener('DOMContentLoaded', async () => {
  const checkbox = document.getElementById('consentCheckbox');
  const btnContinue = document.getElementById('btnContinue');
  const btnDecline = document.getElementById('btnDecline');
  const errorBanner = document.getElementById('errorBanner');
  
  const declineModal = document.getElementById('declineModal');
  const btnCancelDecline = document.getElementById('btnCancelDecline');
  const btnConfirmDecline = document.getElementById('btnConfirmDecline');

  // Toggle Continue button enabled state
  checkbox.addEventListener('change', () => {
    btnContinue.disabled = !checkbox.checked;
  });

  // Handle Continue & Consent Acceptance
  btnContinue.addEventListener('click', async () => {
    if (!checkbox.checked) return;

    btnContinue.disabled = true;
    btnContinue.innerHTML = '<span>Recording Consent...</span>';
    errorBanner.style.display = 'none';

    try {
      // Transition to Identity Capture
      await window.api.proceedToIdentity({
        consentGiven: true,
        consentTimestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Consent] Failed to proceed:', err);
      errorBanner.textContent = err.message || 'Failed to record consent. Please try again.';
      errorBanner.style.display = 'block';
      btnContinue.disabled = false;
      btnContinue.innerHTML = '<span>I Agree & Continue to Identification</span> <span>➔</span>';
    }
  });

  // Handle Decline Button Click (Show Modal)
  btnDecline.addEventListener('click', () => {
    declineModal.style.display = 'flex';
  });

  // Cancel Decline Modal
  btnCancelDecline.addEventListener('click', () => {
    declineModal.style.display = 'none';
  });

  // Confirm Decline (Gracefully Exit Application)
  btnConfirmDecline.addEventListener('click', async () => {
    try {
      const sessionInfo = await window.api.getSessionInfo();
      const serverUrl = sessionInfo.serverUrl || 'http://localhost:5000';
      const sessionId = sessionInfo.sessionId;

      if (sessionId) {
        // Optionally mark consent declined or end session on server
        await fetch(`${serverUrl}/sessions/${sessionId}/consent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consentGiven: false })
        }).catch(() => {});
      }
    } catch (e) {
      // Ignore
    } finally {
      await window.api.declineConsent();
    }
  });
});
