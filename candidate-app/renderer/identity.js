document.addEventListener('DOMContentLoaded', async () => {
  const nameInput = document.getElementById('studentName');
  const rollInput = document.getElementById('rollNumber');
  const btnSubmit = document.getElementById('btnSubmitIdentity');
  const errorBanner = document.getElementById('errorBanner');
  const examCodeText = document.getElementById('examCodeText');

  let activeExamId = 'EXAM-101';
  let serverUrl = 'http://localhost:5000';
  let consentData = null;

  try {
    const sessionInfo = await window.api.getSessionInfo();
    if (sessionInfo) {
      if (sessionInfo.examId) activeExamId = sessionInfo.examId;
      if (sessionInfo.serverUrl) serverUrl = sessionInfo.serverUrl;
      if (sessionInfo.studentName) nameInput.value = sessionInfo.studentName;
      if (sessionInfo.rollNumber) rollInput.value = sessionInfo.rollNumber;
      consentData = {
        consentGiven: sessionInfo.consentGiven !== undefined ? sessionInfo.consentGiven : true,
        consentTimestamp: sessionInfo.consentTimestamp || new Date().toISOString()
      };
    }
  } catch (err) {
    console.warn('[Identity] Could not get session info from Electron:', err);
  }

  // Also check sessionStorage fallback
  try {
    const saved = JSON.parse(sessionStorage.getItem('sessionInfo') || '{}');
    if (saved.examId) activeExamId = saved.examId;
    if (saved.studentName && !nameInput.value) nameInput.value = saved.studentName;
    if (saved.rollNumber && !rollInput.value) rollInput.value = saved.rollNumber;
  } catch (e) {}

  examCodeText.textContent = `Exam: ${activeExamId}`;

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
  }

  function clearError() {
    errorBanner.textContent = '';
    errorBanner.style.display = 'none';
  }

  async function handleSubmit() {
    clearError();
    const studentName = nameInput.value.trim();
    const rollNumber = rollInput.value.trim();

    // 1. Basic Name Validation
    if (!studentName) {
      showError('Please enter your full name.');
      nameInput.focus();
      return;
    }
    if (studentName.length < 2) {
      showError('Full name must contain at least 2 characters.');
      nameInput.focus();
      return;
    }

    // 2. Roll Number Format Validation
    if (!rollNumber) {
      showError('Please enter your roll or registration number.');
      rollInput.focus();
      return;
    }
    const rollRegex = /^[A-Za-z0-9\-\_\/\. ]{2,35}$/;
    if (!rollRegex.test(rollNumber)) {
      showError('Roll number contains invalid characters. Use letters, numbers, hyphens, and slashes.');
      rollInput.focus();
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<span>Creating Session...</span>';

    try {
      const payload = {
        examId: activeExamId,
        studentName: studentName,
        rollNumber: rollNumber,
        studentId: rollNumber,
        consentGiven: consentData ? consentData.consentGiven : true,
        consentTimestamp: consentData ? consentData.consentTimestamp : new Date().toISOString()
      };

      console.log('[Identity] Creating candidate session with payload:', payload);

      const response = await fetch(`${serverUrl}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${response.status})`);
      }

      const session = await response.json();
      const sessionId = session._id || session.sessionId;

      if (!sessionId) {
        throw new Error('Server did not return a valid session ID.');
      }

      const sessionObj = {
        sessionId,
        examId: activeExamId,
        studentName,
        rollNumber,
        studentId: rollNumber,
        serverUrl
      };

      sessionStorage.setItem('sessionInfo', JSON.stringify(sessionObj));
      localStorage.setItem('sessionInfo', JSON.stringify(sessionObj));

      // Transition to System Self-Check in Electron
      await window.api.proceedToSelfCheck({
        sessionId,
        examId: activeExamId,
        studentName,
        rollNumber,
        studentId: rollNumber
      });
    } catch (err) {
      console.error('[Identity] Error creating session:', err);
      showError(err.message || 'Failed to create exam session. Please verify backend connection.');
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<span>Continue to System Check</span> <span>➔</span>';
    }
  }

  btnSubmit.addEventListener('click', handleSubmit);

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') rollInput.focus();
  });

  rollInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });
});
