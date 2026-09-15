import mammoth from '../electron/node_modules/mammoth/mammoth.browser.js';

async function init() {
  const statusEl = document.getElementById('statusIndicator');
  const paperViewer = document.getElementById('paperViewer');
  const loadingEl = document.getElementById('loadingMessage');
  
  try {
    const sessionInfo = await window.api.getSessionInfo();
    if (!sessionInfo || !sessionInfo.examId) {
      throw new Error("Missing session information.");
    }
    
    const paperUrl = `${sessionInfo.serverUrl}/exam/${sessionInfo.examId}/paper`;
    const response = await fetch(paperUrl);
    
    if (response.status === 404) {
      loadingEl.innerHTML = `<div class="info-message">Exam paper not yet available &mdash; please wait for your examiner.</div>`;
      return;
    }
    
    if (response.status === 403) {
      loadingEl.innerHTML = `<div class="error-message">Session not active. Please ensure you have officially started the exam.</div>`;
      return;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to load paper (HTTP ${response.status})`);
    }

    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();

    loadingEl.style.display = 'none';

    if (contentType.includes('pdf')) {
      await renderPdf(arrayBuffer, paperViewer);
    } else if (contentType.includes('wordprocessingml') || contentType.includes('msword')) {
      await renderDocx(arrayBuffer, paperViewer);
    } else {
      // Fallback: try to guess by magic bytes or just treat as PDF for safety
      try {
        await renderPdf(arrayBuffer, paperViewer);
      } catch (e) {
        loadingEl.style.display = 'block';
        loadingEl.innerHTML = `<div class="error-message">Unsupported file format uploaded.</div>`;
      }
    }
    
  } catch (error) {
    console.error('Error fetching/rendering paper:', error);
    loadingEl.style.display = 'block';
    loadingEl.innerHTML = `<div class="error-message">Failed to load exam paper: ${error.message}</div>`;
  }
}

async function renderPdf(buffer, container) {
  // Use Chromium's native PDF viewer instead of PDF.js
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);
  container.innerHTML = `<iframe src="${blobUrl}" style="width:100%; height:100%; border:none;" title="Exam Paper PDF"></iframe>`;
}

async function renderDocx(buffer, container) {
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  container.innerHTML = `
    <div class="docx-container">
      ${result.value}
    </div>
  `;
}

// Ensure the code runs when loaded
window.addEventListener('DOMContentLoaded', () => {
  init();
});

// Original test violation logic
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('testViolationBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      const sessionInfo = await window.api.getSessionInfo();
      const payload = {
        sessionId: sessionInfo ? sessionInfo.sessionId : "unknown",
        type: "second_person_detected",
        severity: 4,
        timestamp: new Date().toISOString(),
        details: {
          confidence: 0.95,
          duration: 3000
        }
      };

      console.log('Sending test violation:', payload);
      window.api.sendTestViolation(payload);
      
      const originalText = btn.innerText;
      btn.innerText = 'Sent!';
      btn.style.backgroundColor = '#4caf50';
      setTimeout(() => {
        btn.innerText = originalText;
        btn.style.backgroundColor = '';
      }, 1500);
    });
  }
});
