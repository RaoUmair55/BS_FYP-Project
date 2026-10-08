/*
 * IntegrityFlow file overview
 * Purpose: Behavior for accepting or declining monitoring consent.
 * How it works: Requires the checkbox before continuing, passes an acceptance timestamp to Electron, displays failures, and confirms a decline before exiting.
 * Connection: Works with consent.html and moves an accepting candidate to the identity screen.
 */
document.addEventListener('DOMContentLoaded', /* Function purpose: Handles the DOMContentLoaded event and updates the associated screen or process state. */ async () => {
  const checkbox = document.getElementById('consentCheckbox');
  const btnContinue = document.getElementById('btnContinue');
  const btnDecline = document.getElementById('btnDecline');
  const errorBanner = document.getElementById('errorBanner');
  
  const declineModal = document.getElementById('declineModal');
  const btnCancelDecline = document.getElementById('btnCancelDecline');
  const btnConfirmDecline = document.getElementById('btnConfirmDecline');

  // Toggle Continue button enabled state
  checkbox.addEventListener('change', /* Function purpose: Handles the change event and updates the associated screen or process state. */ () => {
    btnContinue.disabled = !checkbox.checked;
  });

  // Handle Continue & Consent Acceptance
  btnContinue.addEventListener('click', /* Function purpose: Handles the click event and updates the associated screen or process state. */ async () => {
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
  btnDecline.addEventListener('click', /* Function purpose: Handles the click event and updates the associated screen or process state. */ () => {
    declineModal.style.display = 'flex';
  });

  // Cancel Decline Modal
  btnCancelDecline.addEventListener('click', /* Function purpose: Handles the click event and updates the associated screen or process state. */ () => {
    declineModal.style.display = 'none';
  });

  // Confirm Decline (Gracefully Exit Application)
  btnConfirmDecline.addEventListener('click', /* Function purpose: Handles the click event and updates the associated screen or process state. */ async () => {
    await window.api.declineConsent();
  });
});
