import psutil
import threading
import time
import json
import os
from datetime import datetime, timezone
from services.capture import capture_screenshot

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
        self.unkillable_pids = set()
        
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

        # If developer allows dev browsers for testing the dashboard or runs in dev mode,
        # permit Edge and Chrome so the tester can monitor the dashboard simultaneously.
        allow_dev_browsers = os.environ.get("ALLOW_DEV_BROWSERS", "false").lower() in ("true", "1")
        app_mode = os.environ.get("APP_MODE", "").lower()
        if allow_dev_browsers or app_mode == "dev":
            self.EXAM_BLOCKED.discard("msedge.exe")
            self.EXAM_BLOCKED.discard("chrome.exe")

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
        
        # Hardcoded list of common Windows services/drivers/telemetry to skip
        # as false positives during self-check.
        self.KNOWN_BACKGROUND_SERVICES = {
            "searchindexer.exe", "searchprotocolhost.exe", "searchfilterhost.exe",
            "officeclicktorun.exe", "mousocoreworker.exe", "unsecapp.exe",
            "wmiprvse.exe", "dllhost.exe", "registry", "memory compression",
            "securityhealthservice.exe", "msmpeng.exe", "nissrv.exe",
            "smartscreen.exe", "aggregatorhost.exe", "compattelrunner.exe",
            "backgroundtaskhost.exe", "backgroundtransferhost.exe",
            "dashost.exe", "sppsvc.exe", "wudfhost.exe", "comppkgsrv.exe",
            "msedgewebview2.exe", "tiworker.exe", "trustedinstaller.exe",
            "lsaiso.exe", "systemsettings.exe", "intelcphservice.exe",
            "intelcphdcpsvc.exe", "intelcphecisvc.exe",
            "igfxcuiservice.exe", "chrome-native-host.exe"
        }
        
        # Protect this exact AI module process instance
        self.protected_pid = os.getpid()
        self.protected_pids = {self.protected_pid}
        
        # Dynamically protect the developer's process tree (e.g., VS Code and its terminals).
        # This prevents the AI module from committing suicide by killing the terminal/IDE hosting it.
        try:
            curr = psutil.Process(self.protected_pid)
            while curr.parent() is not None and curr.parent().name().lower() not in self.SAFETY_LIST:
                curr = curr.parent()
                self.protected_pids.add(curr.pid)
            
            # Protect all descendants of the dev environment root (protects sibling dev servers)
            for child in curr.children(recursive=True):
                self.protected_pids.add(child.pid)
        except Exception:
            pass

    def _get_window_titles(self):
        try:
            import ctypes
            EnumWindows = ctypes.windll.user32.EnumWindows
            EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
            GetWindowText = ctypes.windll.user32.GetWindowTextW
            GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
            IsWindowVisible = ctypes.windll.user32.IsWindowVisible
            GetWindowThreadProcessId = ctypes.windll.user32.GetWindowThreadProcessId

            titles = {}
            def foreach_window(hwnd, lParam):
                if IsWindowVisible(hwnd):
                    length = GetWindowTextLength(hwnd)
                    if length > 0:
                        buff = ctypes.create_unicode_buffer(length + 1)
                        GetWindowText(hwnd, buff, length + 1)
                        pid = ctypes.c_ulong()
                        GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                        if pid.value not in titles:
                            titles[pid.value] = buff.value
                return True
            EnumWindows(EnumWindowsProc(foreach_window), 0)
            return titles
        except Exception:
            return {}

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
            # Only perform active process killing and violation reporting during actual EXAM mode
            if self.mode != "exam":
                time.sleep(2.0)
                continue

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
                    
                    # 2. Protect the AI module and its dev environment dynamically
                    if pid in self.protected_pids or pid in self.unkillable_pids:
                        continue
                        
                    # 3. Protect critical OS processes
                    if name_lower in self.SAFETY_LIST:
                        continue
                        
                    # 3.5. Ignore known harmless background services and drivers
                    if name_lower in self.KNOWN_BACKGROUND_SERVICES or name_lower.startswith("antigravitysetup"):
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
        
        # Calculate severity (base 3, +1 for each repeat, max 5)
        severity = min(5, 3 + (count - 1))
        
        # Wait a very brief moment to let the UI render, but not long enough to hang the loop
        time.sleep(0.5)
        
        # Capture screenshot BEFORE terminating the app, so we get the evidence
        screenshot_path = capture_screenshot(self.session_id, "unauthorized_app")
        
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
            self.unkillable_pids.add(pid) # Don't try to kill it again
            return # If we couldn't kill it, maybe we don't send the violation yet.
        
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
        
        if screenshot_path:
            payload["screenshotPath"] = screenshot_path
        
        # Dispatch
        try:
            if self.on_violation_callback:
                self.on_violation_callback(payload)
        except Exception as e:
            print(f"[WhitelistEnforcer] Error sending violation callback: {e}")

    def check_running_apps(self):
        """
        One-off check to list currently running non-whitelisted apps using dev_whitelist rules.
        """
        config_path = os.path.join(os.path.dirname(__file__), 'config', 'whitelist.json')
        dev_whitelist = set()
        try:
            with open(config_path, 'r') as f:
                data = json.load(f)
                entries = data.get('dev_whitelist', [])
                dev_whitelist = {app.lower() for app in entries}
        except Exception as e:
            print(f"[WhitelistEnforcer] Error loading dev whitelist for check: {e}")
            
        unauthorized_apps = []
        current_user = os.environ.get('USERNAME', '').lower()
        window_titles = self._get_window_titles()
        seen_names = set()
        
        for proc in psutil.process_iter(['pid', 'name', 'username']):
            try:
                name = proc.info.get('name')
                username = proc.info.get('username') or ''
                pid = proc.info.get('pid')
                if not name: 
                    continue
                    
                username_lower = username.lower()
                if not username_lower or any(sys_acc in username_lower for sys_acc in ['nt authority\\system', 'local service', 'network service', 'window manager']): 
                    continue
                    
                if current_user and current_user not in username_lower:
                    continue
                
                name_lower = name.lower()
                if pid == self.protected_pid: 
                    continue
                if name_lower in self.SAFETY_LIST: 
                    continue
                if name_lower in self.KNOWN_BACKGROUND_SERVICES:
                    continue
                if name_lower in dev_whitelist: 
                    continue
                
                if name_lower in seen_names:
                    continue
                seen_names.add(name_lower)
                
                title = window_titles.get(pid)
                display_name = f"{title} ({name})" if title else name
                unauthorized_apps.append({"name": name, "display": display_name})
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
            except Exception as e:
                pass
                
        return unauthorized_apps
