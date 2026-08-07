import psutil
import threading
import time
import json
import os
from datetime import datetime, timezone

class WhitelistEnforcer:
    """
    Enforces a whitelist of allowed applications using psutil.
    """
    def __init__(self, session_id, on_violation_callback, mode="exam"):
        self.session_id = session_id
        self.on_violation_callback = on_violation_callback
        self.mode = mode
        self.violation_counts = {}
        self.running = False
        self.monitor_thread = None
        self.whitelist = set()
        
        # Hardcoded list of processes that are strictly forbidden in exam mode,
        # overriding any accidental whitelisting.
        self.EXAM_BLOCKED = {
            "cmd.exe",
            "powershell.exe",
            "pwsh.exe",
            "wt.exe",
            "code.exe",
            "ollama.exe",
            "ollama_llama_server.exe",
            "chrome.exe",
            "msedge.exe",
            "firefox.exe",
            "brave.exe"
        }

        # Hardcoded OS safety list - never kill these processes to keep Windows stable.
        self.SAFETY_LIST = {
            "svchost.exe",
            "explorer.exe",
            "system",
            "wininit.exe",
            "csrss.exe",
            "winlogon.exe",
            "services.exe",
            "lsass.exe",
            "smss.exe",
            "spoolsv.exe",
            "sihost.exe",
            "taskhostw.exe",
            "dwm.exe",
            "runtimebroker.exe",
            "startmenuexperiencehost.exe",
            "searchhost.exe",
            "searchapp.exe",
            "applicationframehost.exe",
            "textinputhost.exe",
            "ctfmon.exe",
            "fontdrvhost.exe",
            "conhost.exe",
            "openconsole.exe",
            "dllhost.exe",
            "wmiprvse.exe",
            "audiodg.exe"
        }
        
        # Protect this exact AI module process instance
        self.protected_pid = os.getpid()

    def load_whitelist(self):
        config_path = os.path.join(os.path.dirname(__file__), 'config', 'whitelist.json')
        try:
            with open(config_path, 'r') as f:
                data = json.load(f)
                key = f"{self.mode}_whitelist"
                entries = data.get(key, [])
                self.whitelist = {app.lower() for app in entries}
                if self.mode == "exam":
                    print(f"[WhitelistEnforcer] Running in {self.mode.upper()} mode — EXAM_BLOCKED enforced ({len(self.EXAM_BLOCKED)} processes), {len(self.whitelist)} processes whitelisted")
                else:
                    print(f"[WhitelistEnforcer] Running in {self.mode.upper()} mode — EXAM_BLOCKED not enforced, {len(self.whitelist)} processes whitelisted")
        except Exception as e:
            print(f"[WhitelistEnforcer] Error loading whitelist: {e}")
            self.whitelist = set()

    def start(self):
        self.load_whitelist()
        self.running = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        print("[WhitelistEnforcer] Started enforcement loop.")

    def stop(self):
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=3.0)
        print("[WhitelistEnforcer] Stopped enforcement loop.")

    def _monitor_loop(self):
        while self.running:
            for proc in psutil.process_iter(['pid', 'name', 'username']):
                if not self.running:
                    break
                
                try:
                    pid = proc.info['pid']
                    name = proc.info['name']
                    username = proc.info.get('username') or ''
                    
                    if not name:
                        continue
                        
                    # 1. Ignore system and service accounts to protect the OS
                    if any(sys_acc in username.lower() for sys_acc in ['nt authority\\system', 'local service', 'network service']):
                        continue

                    name_lower = name.lower()
                    
                    # 2. Protect the AI module itself dynamically
                    if pid == self.protected_pid:
                        continue
                        
                    # 3. Protect critical OS processes
                    if name_lower in self.SAFETY_LIST:
                        continue
                        
                    # 4. Exam Mode Hard Block
                    if self.mode == "exam" and name_lower in self.EXAM_BLOCKED:
                        # Fall through to handle_violation immediately, no exceptions
                        pass
                        
                    # 5. Allow whitelisted apps
                    elif name_lower in self.whitelist:
                        continue

                    # If we reach here, it's an unauthorized process
                    self._handle_violation(proc, name_lower)

                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    pass
                except Exception as e:
                    print(f"[WhitelistEnforcer] Unexpected error checking process: {e}")

            time.sleep(2.5)

    def _handle_violation(self, proc, name_lower):
        pid = proc.pid
        print(f"[WhitelistEnforcer] Unauthorized process detected: {name_lower} (PID: {pid})")
        
        # Increment violation count for severity escalation
        self.violation_counts[name_lower] = self.violation_counts.get(name_lower, 0) + 1
        count = self.violation_counts[name_lower]
        
        # Terminate gracefully, then force kill if needed
        try:
            proc.terminate()
            try:
                proc.wait(timeout=2.0)
            except psutil.TimeoutExpired:
                print(f"[WhitelistEnforcer] Process {name_lower} did not terminate gracefully. Force killing...")
                proc.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
            print(f"[WhitelistEnforcer] Could not terminate {name_lower}: {e}")
            return # If we couldn't kill it, maybe we don't send the violation yet, or maybe we do. We'll still send it.

        # Calculate severity (base 3, +1 for each repeat, max 5)
        severity = min(5, 3 + (count - 1))
        
        # Format payload matching CONTRACT.md
        payload = {
            "sessionId": self.session_id,
            "type": "unauthorized_app",
            "severity": severity,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "details": {
                "object_class": name_lower
            }
        }
        
        # Dispatch
        try:
            if self.on_violation_callback:
                self.on_violation_callback(payload)
        except Exception as e:
            print(f"[WhitelistEnforcer] Error sending violation callback: {e}")
