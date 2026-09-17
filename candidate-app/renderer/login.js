async function handleLogin() {
  const examId = document.getElementById('examId').value.trim();
  const studentId = document.getElementById('studentId').value.trim();
  const btn = document.getElementById('loginBtn');
  const errorMsg = document.getElementById('errorMsg');
  
  if (!examId || !studentId) {
    errorMsg.textContent = 'Please enter both Exam ID and Student ID.';
    return;
  }
  
  errorMsg.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  
  try {
    const sessionInfo = await window.api.getSessionInfo();
    const serverUrl = sessionInfo.serverUrl;
    
    // Create session on the backend
    const response = await fetch(`${serverUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        examId: examId,
        studentId: studentId
      })
    });
    
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to connect to server.');
    }
    
    const data = await response.json();
    const sessionId = data._id; // MongoDB creates an _id
    
    const sessionInfoObj = { sessionId, examId, studentId };
    sessionStorage.setItem('sessionInfo', JSON.stringify(sessionInfoObj));
    localStorage.setItem('sessionInfo', JSON.stringify(sessionInfoObj));

    // Tell Electron main process to log us in
    const result = await window.api.login({ sessionId, examId, studentId });
    if (!result.success) {
      throw new Error(result.error || 'Internal app error');
    }
  } catch (error) {
    errorMsg.textContent = error.message;
    btn.disabled = false;
    btn.textContent = 'Start Exam Session';
  }
}

document.getElementById('loginBtn').addEventListener('click', handleLogin);

document.getElementById('studentId').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin();
});
