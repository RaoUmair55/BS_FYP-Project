let isSubmitting = false;

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
    } catch (e) {}

    let allowedApplications = [];
    // Check if the exam code exists on the backend if available
    try {
      const checkRes = await fetch(`${serverUrl}/exams/code/${encodeURIComponent(examId)}`);
      if (checkRes.ok) {
        const examData = await checkRes.json();
        if (examData.status && examData.status.toLowerCase() !== 'active') {
          throw new Error(`Exam "${examData.title || examId}" is currently ${examData.status.toUpperCase()} and not accepting candidates.`);
        }
        if (examData.allowedApplications && Array.isArray(examData.allowedApplications)) {
          allowedApplications = examData.allowedApplications;
        }
      } else if (checkRes.status === 404) {
        throw new Error(`Exam code "${examId}" not found. Please verify the code with your instructor.`);
      }
    } catch (fetchErr) {
      // If network error / backend unreachable, we warn or re-throw specific message
      if (fetchErr.message && !fetchErr.message.includes('Failed to fetch')) {
        throw fetchErr;
      }
    }
    
    const entryData = { examId, allowedApplications };
    sessionStorage.setItem('sessionInfo', JSON.stringify(entryData));
    localStorage.setItem('sessionInfo', JSON.stringify(entryData));

    // Tell Electron main process to initialize exam entry
    const result = await window.api.login(entryData);
    if (result && !result.success) {
      throw new Error(result.error || 'Internal app initialization error');
    }
  } catch (error) {
    isSubmitting = false;
    errorMsg.textContent = error.message;
    btn.disabled = false;
    btn.textContent = 'Enter Exam ➔';
  }
}

document.getElementById('loginBtn').addEventListener('click', (e) => {
  e.preventDefault();
  handleLogin();
});

document.getElementById('examId').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleLogin();
  }
});
