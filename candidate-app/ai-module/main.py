import uvicorn
import os
import requests
import threading
import time
import psutil
from whitelist_enforcer import WhitelistEnforcer
from usb_monitor import USBMonitor
from ai_monitor import AIMonitor
import server

ELECTRON_RECEIVER_URL = "http://127.0.0.1:8766/violation"

def send_violation_to_electron(payload):
    try:
        requests.post(ELECTRON_RECEIVER_URL, json=payload, timeout=2.0)
    except Exception as e:
        print(f"[AI Module] Failed to send violation to Electron: {e}")

def monitor_cpu_budget():
    """Reports process and overall CPU usage every 30 seconds."""
    proc = psutil.Process()
    # Baseline call
    proc.cpu_percent(interval=None)
    psutil.cpu_percent(interval=None)
    
    while True:
        time.sleep(30)
        try:
            num_cores = psutil.cpu_count() or 1
            proc_cpu = proc.cpu_percent(interval=None) / num_cores
            sys_cpu = psutil.cpu_percent(interval=None)
            print(f"[AI Module Metrics] Process CPU Usage: {proc_cpu:.1f}% | System Total CPU: {sys_cpu:.1f}% (Target: <35% average)")
        except Exception as e:
            print(f"[AI Module Metrics] Could not log CPU usage: {e}")

if __name__ == "__main__":
    exam_session_id = os.environ.get("EXAM_SESSION_ID", "unknown-session")
    app_mode = os.environ.get("APP_MODE", "exam")
    
    # Start CPU budget monitor thread
    cpu_thread = threading.Thread(target=monitor_cpu_budget, daemon=True)
    cpu_thread.start()
    
    is_self_check = os.environ.get("IS_SELF_CHECK", "false").lower() in ("true", "1")
    
    enforcer = WhitelistEnforcer(
        session_id=exam_session_id, 
        on_violation_callback=send_violation_to_electron,
        mode=app_mode,
        is_self_check=is_self_check
    )
    # Inject enforcer instance so server can use it for check_running_apps
    server.enforcer = enforcer
    enforcer.start()
    
    usb_monitor = USBMonitor(
        session_id=exam_session_id,
        on_violation_callback=send_violation_to_electron,
        is_self_check=is_self_check
    )
    # Inject usb_monitor instance so server can use it for /check-usb
    server.usb_monitor = usb_monitor
    usb_monitor.start()
    
    if not is_self_check:
        try:
            monitor = AIMonitor(
                session_id=exam_session_id,
                on_violation_callback=send_violation_to_electron
            )
            monitor.start()
        except Exception as e:
            print(f"[AI Module Warning] Could not start AIMonitor: {e}")
    else:
        print("[AI Module] Self-check mode active. Skipping AIMonitor camera initialization until exam starts.")
    
    try:
        uvicorn.run(server.app, host="127.0.0.1", port=8000)
    finally:
        enforcer.stop()
        usb_monitor.stop()
