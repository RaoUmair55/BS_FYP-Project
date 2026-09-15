import uvicorn
import os
import requests
from whitelist_enforcer import WhitelistEnforcer
from ai_monitor import AIMonitor
import server

ELECTRON_RECEIVER_URL = "http://localhost:8766/violation"

def send_violation_to_electron(payload):
    try:
        requests.post(ELECTRON_RECEIVER_URL, json=payload, timeout=2.0)
    except Exception as e:
        print(f"[AI Module] Failed to send violation to Electron: {e}")

if __name__ == "__main__":
    exam_session_id = os.environ.get("EXAM_SESSION_ID", "unknown-session")
    app_mode = os.environ.get("APP_MODE", "exam")
    
    enforcer = WhitelistEnforcer(
        session_id=exam_session_id, 
        on_violation_callback=send_violation_to_electron,
        mode=app_mode
    )
    # Inject enforcer instance so server can use it for check_running_apps
    server.enforcer = enforcer
    
    monitor = AIMonitor(
        session_id=exam_session_id,
        on_violation_callback=send_violation_to_electron
    )
    
    enforcer.start()
    monitor.start()
    
    try:
        uvicorn.run(server.app, host="127.0.0.1", port=8000)
    finally:
        enforcer.stop()
