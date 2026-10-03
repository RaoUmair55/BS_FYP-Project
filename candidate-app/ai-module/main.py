import warnings
warnings.filterwarnings('ignore')
import uvicorn
import os
import json
import requests
import threading
import time
import socket
import queue
import psutil
from whitelist_enforcer import WhitelistEnforcer
from usb_monitor import USBMonitor
import server

ELECTRON_RECEIVER_URL = f"http://127.0.0.1:{int(os.getenv('ELECTRON_RECEIVER_PORT', '8766'))}/violation"

# ponytail: one bounded transport worker; durable spool if Electron itself becomes unreliable.
violation_queue = queue.Queue(maxsize=100)

def _deliver_violations():
    while True:
        payload = violation_queue.get()
        try:
            started = time.monotonic()
            requests.post(ELECTRON_RECEIVER_URL, json=payload, timeout=15.0).raise_for_status()
            print(f"[Alert Delivery] {payload.get('type')} acknowledged in {time.monotonic() - started:.2f}s", flush=True)
        except Exception as e:
            print(f"[AI Module] Failed to send violation to Electron: {e}", flush=True)
        finally:
            violation_queue.task_done()

threading.Thread(target=_deliver_violations, daemon=True).start()

def send_violation_to_electron(payload):
    if os.environ.get("IS_SELF_CHECK", "false").lower() in ("true", "1"):
        return
    try:
        violation_queue.put_nowait(payload)
    except queue.Full:
        server.startup_errors.append('Alert delivery queue full. Notify the examiner.')
        print('[AI Module Error] Alert delivery queue full.', flush=True)


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
    is_self_check = os.environ.get("IS_SELF_CHECK", "false").lower() in ("true", "1")
    exam_type = os.environ.get("EXAM_TYPE", "online").lower()
    is_physical_lab = (exam_type == "physical_lab")
    port = int(os.getenv("PYTHON_IPC_PORT", "0"))
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(('127.0.0.1', port))
    listener.listen(128)
    listener.set_inheritable(True)
    print(f"INTEGRITYFLOW_PORT={listener.getsockname()[1]}", flush=True)
    server.startup_errors = []

    # Start CPU budget monitor thread
    cpu_thread = threading.Thread(target=monitor_cpu_budget, daemon=True)
    cpu_thread.start()

    @server.app.on_event("startup")
    def on_startup():
        print("[AI Module] Initializing subsystem monitors...")
        enforcer = WhitelistEnforcer(
            session_id=exam_session_id,
            on_violation_callback=send_violation_to_electron,
            mode=app_mode,
            is_self_check=is_self_check
        )
        server.enforcer = enforcer
        exam_rules = json.loads(os.environ.get('EXAM_RULES', '{}'))
        if not is_self_check and exam_rules.get('enforceAppWhitelist') is not False:
            enforcer.start()
        elif is_self_check:
            print("[AI Module] Self-check mode active: Whitelist continuous background enforcement paused.")

        usb_monitor = USBMonitor(
            session_id=exam_session_id,
            on_violation_callback=send_violation_to_electron,
            is_self_check=is_self_check
        )
        server.usb_monitor = usb_monitor
        if not is_self_check:
            usb_monitor.start()
        else:
            print("[AI Module] Self-check mode active: USB continuous background monitoring paused.")

        if is_physical_lab:
            server.voice_monitor = None
            print("[AI Module] 🏫 Physical Lab Exam Mode active. Webcam AIMonitor and VoiceMonitor are bypassed.")
        else:
            from voice_monitor import VoiceMonitor
            voice_monitor = VoiceMonitor(
                session_id=exam_session_id,
                on_violation_callback=send_violation_to_electron,
                is_self_check=is_self_check
            )
            server.voice_monitor = voice_monitor

            if not is_self_check:
                try:
                    from ai_monitor import AIMonitor
                    monitor = AIMonitor(
                        session_id=exam_session_id,
                        on_violation_callback=send_violation_to_electron
                    )
                    monitor.start()
                    server.ai_monitor = monitor
                except Exception as e:
                    server.startup_errors.append(f"Camera monitor could not start: {e}")
                    print(f"[AI Module Warning] Could not start AIMonitor: {e}")

                try:
                    voice_monitor.start()
                except Exception as e:
                    server.startup_errors.append(f"Voice monitor could not start: {e}")
                    print(f"[AI Module Warning] Could not start VoiceMonitor: {e}")
            else:
                print("[AI Module] Self-check mode active. Skipping AIMonitor and VoiceMonitor continuous streams until exam starts.")

        print("[AI Module] Subsystems ready.")

    @server.app.on_event("shutdown")
    def on_shutdown():
        print("[AI Module] Shutting down monitors...")
        if hasattr(server, 'enforcer') and server.enforcer:
            server.enforcer.stop()
        if hasattr(server, 'usb_monitor') and server.usb_monitor:
            server.usb_monitor.stop()
        if hasattr(server, 'voice_monitor') and server.voice_monitor:
            server.voice_monitor.stop()
        if hasattr(server, 'ai_monitor') and server.ai_monitor:
            server.ai_monitor.stop()

    print(f"[AI Module] Starting uvicorn server on port {listener.getsockname()[1]}...")
    try:
        uvicorn.Server(uvicorn.Config(server.app, host='127.0.0.1', port=port)).run(sockets=[listener])
    finally:
        listener.close()
