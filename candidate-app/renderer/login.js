/*
 * IntegrityFlow file overview
 * Purpose: Behavior for the exam-code entry screen.
 * How it works: Normalizes and validates the code, asks the central server whether the exam accepts candidates, loads its mode/rules/allowed applications, and hands the entry information to Electron.
 * Connection: Works with login.html; exam-code entry comes before consent and candidate identity.
 */
let isSubmitting = false;

// Function purpose: Validates the exam entry fields and requests candidate login.
async function handleLogin() {
  if (isSubmitting) return;

  const examIdInput = document.getElementById('examId');
  const examId = examIdInput.value.trim().toUpperCase();
  const btn = document.getElementById('loginBtn');
  const errorMsg = document.getElementById('errorMsg');

  if (!examId) {
    errorMsg.textContent = 'Please enter an Exam Code.';
    examIdInput.focus();
    return;
  }
  if (!/^[A-Z0-9-]{4,32}$/.test(examId) || !/[A-Z0-9]/.test(examId)) {
    errorMsg.textContent = 'Exam code must contain 4-32 letters, numbers or hyphens, including a letter or number (e.g. EXAM-101).';
    examIdInput.setAttribute('aria-invalid', 'true');
    examIdInput.focus();
    return;
  }
  examIdInput.value = examId;
  examIdInput.setAttribute('aria-invalid', 'false');

  isSubmitting = true;
  errorMsg.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Validating Exam Code...';

  try {
    let serverUrl = 'http://localhost:5000';
    try {
      const sessionInfo = await window.api.getSessionInfo();
      if (sessionInfo && sessionInfo.serverUrl) {
        serverUrl = sessionInfo.serverUrl;
      }
    } catch (e) { }

    let allowedApplications = [];
    let examType = 'online';
    let rules = {};
    // Confirm the exam before starting local monitoring.
    {
      const checkRes = await fetch(`${serverUrl}/exams/code/${encodeURIComponent(examId)}`, { signal: AbortSignal.timeout(15000) });
      if (checkRes.ok) {
        const examData = await checkRes.json();
        if (examData.status && examData.status.toLowerCase() !== 'active') {
          throw new Error(`Exam "${examData.title || examId}" is currently ${examData.status.toUpperCase()} and not accepting candidates.`);
        }
        if (examData.examType) {
          examType = examData.examType;
        }
        rules = examData.rules || {};
        if (examData.allowedApplications && Array.isArray(examData.allowedApplications)) {
          allowedApplications = examData.allowedApplications;
        }
      } else {
        const errJson = await checkRes.json().catch(/* Function purpose: Handles a rejected asynchronous operation and reports or recovers from its failure. */ () => ({}));
        if (checkRes.status === 403 || errJson.lobbyClosed) {
          throw new Error(errJson.error || `🚫 Lobby Closed: The question paper has already been released by the examiner. Late entry is not permitted.`);
        } else if (checkRes.status === 404) {
          throw new Error(`Exam code "${examId}" not found. Please verify the code with your instructor.`);
        } else if (errJson.error) {
          throw new Error(errJson.error);
        } else {
          throw new Error(`Could not verify exam code (${checkRes.status}). Please try again.`);
        }
      }
    }

    const entryData = { examId, allowedApplications, examType, rules };
    sessionStorage.setItem('sessionInfo', JSON.stringify(entryData));
    localStorage.setItem('sessionInfo', JSON.stringify(entryData));

    // Tell Electron main process to initialize exam entry
    const result = await window.api.login(entryData);
    if (result && !result.success) {
      throw new Error(result.error || 'Internal app initialization error');
    }
  } catch (error) {
    isSubmitting = false;
    errorMsg.textContent = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'The exam server did not respond. Check your network and SERVER_URL, then retry.' : error.message;
    btn.disabled = false;
    btn.textContent = 'Enter Exam ➔';
  }
}

document.getElementById('loginBtn').addEventListener('click', /* Function purpose: Handles the click event and updates the associated screen or process state. */ (e) => {
  e.preventDefault();
  handleLogin();
});

document.getElementById('examId').addEventListener('keydown', /* Function purpose: Handles the keydown event and updates the associated screen or process state. */ (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleLogin();
  }
});
document.getElementById('examId').addEventListener('input', /* Function purpose: Handles the input event and updates the associated screen or process state. */ (e) => {
  e.target.setAttribute('aria-invalid', 'false');
  document.getElementById('errorMsg').textContent = '';
});
document.getElementById('examId').addEventListener('blur', /* Function purpose: Handles the blur event and updates the associated screen or process state. */ (e) => {
  const code = e.target.value.trim().toUpperCase();
  e.target.value = code;
  if (code && (!/^[A-Z0-9-]{3,32}$/.test(code) || !/[A-Z0-9]/.test(code))) {
    e.target.setAttribute('aria-invalid', 'true');
    document.getElementById('errorMsg').textContent = 'Use 3-32 letters, numbers or hyphens, for example EXAM-101.';
  }
});
