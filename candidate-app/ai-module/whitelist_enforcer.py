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
    def __init__(self, session_id, on_violation_callback, mode="exam", is_self_check=False, allowed_apps=None):
        self.session_id = session_id
        self.on_violation_callback = on_violation_callback
        self.mode = mode
        self.is_self_check = is_self_check
        self.violation_counts = {}
        self.running = False
        self.monitor_thread = None
        self.whitelist = set()
        self.unkillable_pids = set()
        self.allowed_apps = set()
        self.protected_pids = set()
        try:
            current_proc = psutil.Process()
            self.protected_pids.add(current_proc.pid)
            parent = current_proc.parent()
            if parent:
                self.protected_pids.add(parent.pid)
                grandparent = parent.parent()
                if grandparent:
                    self.protected_pids.add(grandparent.pid)
        except Exception:
            self.protected_pids.add(os.getpid())

        self.exam_start_time = time.time()
        self.seen_recent_shortcuts = {}

        # Pre-seed existing shortcuts so existing history isn't treated as new accesses
        recent_dir = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Recent")
        if os.path.isdir(recent_dir):
            try:
                for item in os.listdir(recent_dir):
                    if item.lower().endswith(".lnk"):
                        lp = os.path.join(recent_dir, item)
                        try:
                            self.seen_recent_shortcuts[lp] = os.path.getmtime(lp)
                        except Exception:
                            pass
            except Exception:
                pass

        # Document extensions & keywords monitored when external apps (Word, VS Code, etc.) are allowed
        self.DOC_EXTENSIONS = {
            ".docx", ".doc", ".pdf", ".txt", ".py", ".cpp", ".c", ".java", 
            ".cs", ".js", ".html", ".md", ".rtf", ".ppt", ".pptx", ".xls", ".xlsx"
        }
        self.IGNORE_DIRS = (
            "system32", "program files", "node_modules", "site-packages", 
            "resources", "appdata\\local\\temp", "appdata\\local\\microsoft"
        )

        # Hardcoded list of processes that are strictly forbidden in exam mode,
        # unless explicitly whitelisted by the teacher.
        self.EXAM_BLOCKED = {
            "cmd.exe",
            "powershell.exe",
            "pwsh.exe",
            "wt.exe",
            "code.exe",
            "ollama.exe",
            "ollama_llama_server.exe",
            "ai.exe",
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

        # Parse allowed_apps parameter or ALLOWED_APPLICATIONS env var
        self._parse_allowed_apps(allowed_apps or os.environ.get("ALLOWED_APPLICATIONS"))
        self.load_whitelist()

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
            "shellexperiencehost.exe",
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
            "audiodg.exe",
            # Hardware drivers & platform services
            "syntphelper.exe",
            "syntpenh.exe",
            "presentationfontcache.exe",
            "securityhealthsystray.exe",
            "securityhealthservice.exe",
            "btwrsupportservice.exe",
            "ibtsiva.exe",
            "nvdisplay.container.exe",
            "nvcontainer.exe",
            "nvsphelper64.exe",
            "memcompression",
            "memory compression",
            "igfxem.exe",
            "igfxhk.exe",
            "onedrive.sync.service.exe",
            "onedrive.exe",
            "wlanext.exe",
            "applemobiledeviceprocess.exe",
            "phoneexperiencehost.exe",
            "git-remote-https.exe"
        }
        
        # Hardcoded list of common Windows services/drivers/telemetry/databases to skip
        # as false positives during monitoring and self-check.
        self.KNOWN_BACKGROUND_SERVICES = {
            "searchindexer.exe", "searchprotocolhost.exe", "searchfilterhost.exe",
            "officeclicktorun.exe", "mousocoreworker.exe", "unsecapp.exe",
            "wmiprvse.exe", "dllhost.exe", "registry", "memory compression", "memcompression",
            "securityhealthservice.exe", "securityhealthsystray.exe", "msmpeng.exe", "nissrv.exe",
            "smartscreen.exe", "aggregatorhost.exe", "compattelrunner.exe",
            "backgroundtaskhost.exe", "backgroundtransferhost.exe",
            "dashost.exe", "sppsvc.exe", "wudfhost.exe", "comppkgsrv.exe",
            "msedgewebview2.exe", "tiworker.exe", "trustedinstaller.exe",
            "lsaiso.exe", "systemsettings.exe", "intelcphservice.exe",
            "intelcphdcpsvc.exe", "intelcphecisvc.exe",
            "igfxcuiservice.exe", "igfxem.exe", "igfxhk.exe", "igfxtray.exe",
            "syntphelper.exe", "syntpenh.exe", "presentationfontcache.exe",
            "btwrsupportservice.exe", "ibtsiva.exe",
            "nvdisplay.container.exe", "nvcontainer.exe", "nvsphelper64.exe",
            "onedrive.sync.service.exe", "onedrive.exe", "wlanext.exe",
            "applemobiledeviceprocess.exe", "chrome-native-host.exe", "shellexperiencehost.exe",
            "defendersessionhelper.exe", "phoneexperiencehost.exe", "git-remote-https.exe",
            # Intel platform & graphics services
            "esif_uf.exe", "esif_assist.exe", "oneapp.igcc.winservice.exe", "jhi_service.exe",
            "ipfsvc.exe", "dptf.exe", "igcc.exe", "igcctray.exe",
            # Audio drivers & services (Realtek / Waves MaxxAudio)
            "rtkaudioservice64.exe", "ravbg64.exe", "ravcpl64.exe", "rtkngui64.exe", "wavessvc64.exe",
            # Windows system UI, touch keyboard & shell helpers
            "tabtip.exe", "rundll32.exe", "systemsettingsbroker.exe", "appvshnotify.exe", "video.ui.exe",
            "node_repl.exe", "codex.exe", "codex-code-mode-host.exe",
            # Hyper-V, virtualization & container services
            "vmcompute.exe", "vmms.exe", "vmmem", "vmmemx", "wslservice.exe", "wslhost.exe",
            "docker.exe", "dockerd.exe",
            # Database and developer background daemons
            "postgres.exe", "pg_ctl.exe", "mysqld.exe", "sqlservr.exe", "mongod.exe", "redis-server.exe",
            "adminservice.exe", "wmiapsrv.exe", "cowork-svc.exe", "git.exe", "git-remote-https.exe",
            # Microsoft Office background telemetry
            "msoia.exe", "msoadfs.exe",
            # System installer / maintenance daemons
            "uninstdaemon.exe", "unins000.exe", "uninst.exe", "installer.exe", "uninstall.exe"
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

    def _parse_allowed_apps(self, raw_allowed):
        if not raw_allowed:
            return
        try:
            if isinstance(raw_allowed, str):
                trimmed = raw_allowed.strip()
                if trimmed.startswith('[') or trimmed.startswith('{'):
                    parsed = json.loads(trimmed)
                    if isinstance(parsed, list):
                        for item in parsed:
                            if isinstance(item, dict) and 'executable' in item:
                                self.allowed_apps.add(item['executable'].lower())
                            elif isinstance(item, str):
                                self.allowed_apps.add(item.lower())
                else:
                    for app in trimmed.split(','):
                        if app.strip():
                            self.allowed_apps.add(app.strip().lower())
            elif isinstance(raw_allowed, list):
                for item in raw_allowed:
                    if isinstance(item, dict) and 'executable' in item:
                        self.allowed_apps.add(item['executable'].lower())
                    elif isinstance(item, str):
                        self.allowed_apps.add(item.lower())
            elif isinstance(raw_allowed, set):
                self.allowed_apps = {a.lower() for a in raw_allowed}
                
            # Expand known process aliases for Windows applications
            APP_ALIASES = {
                "calc.exe": ["calculatorapp.exe", "calculator.exe", "calc.exe"],
                "calculatorapp.exe": ["calc.exe", "calculator.exe", "calculatorapp.exe"],
                "calculator.exe": ["calc.exe", "calculatorapp.exe", "calculator.exe"],
                "notepad.exe": ["notepad.exe"],
                "winword.exe": ["winword.exe", "word.exe"],
                "excel.exe": ["excel.exe"],
                "powerpnt.exe": ["powerpnt.exe", "powerpoint.exe"],
                "code.exe": ["code.exe", "code - oss.exe", "vscodium.exe"],
                "codeblocks.exe": ["codeblocks.exe"],
                "devcpp.exe": ["devcpp.exe"],
                "clion64.exe": ["clion64.exe", "clion.exe"],
                "pycharm64.exe": ["pycharm64.exe", "pycharm.exe"],
                "idea64.exe": ["idea64.exe", "idea.exe"],
                "matlab.exe": ["matlab.exe"]
            }
            
            expanded = set()
            for app in self.allowed_apps:
                expanded.add(app)
                if app in APP_ALIASES:
                    for alias in APP_ALIASES[app]:
                        expanded.add(alias)
            self.allowed_apps = expanded
        except Exception as e:
            print(f"[WhitelistEnforcer] Error parsing allowed applications: {e}")

    def set_allowed_apps(self, allowed_apps):
        """
        Dynamically update permitted apps during exam handshake.
        """
        self.allowed_apps = set()
        self._parse_allowed_apps(allowed_apps)
        self.load_whitelist()

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
                entries = data[key]
                if not isinstance(entries, list) or not entries or not all(isinstance(app, str) and app for app in entries):
                    raise ValueError(f'Invalid {key}: expected a non-empty list of process names')
                self.whitelist = {app.lower() for app in entries}
        except Exception as e:
            raise RuntimeError(f'Cannot load process whitelist at {config_path}: {e}') from e

        # Merge dynamic teacher-allowed applications for this specific exam
        if self.allowed_apps:
            for app in self.allowed_apps:
                app_lower = app.lower()
                self.EXAM_BLOCKED.discard(app_lower)
                self.whitelist.add(app_lower)
            
            # If Microsoft Office applications are permitted by the teacher,
            # allow Office's internal background AI/Copilot process (ai.exe) as well.
            office_apps = {"winword.exe", "word.exe", "excel.exe", "powerpnt.exe", "powerpoint.exe"}
            if any(oa in self.allowed_apps for oa in office_apps):
                self.EXAM_BLOCKED.discard("ai.exe")
                self.whitelist.add("ai.exe")
                self.allowed_apps.add("ai.exe")
                print("[WhitelistEnforcer] Permitted Office AI background companion (ai.exe) for Microsoft Office.")

            print(f"[WhitelistEnforcer] Dynamically whitelisted {len(self.allowed_apps)} teacher-permitted tools: {list(self.allowed_apps)}")

        if self.mode == "exam":
            print(f"[WhitelistEnforcer] Running in {self.mode.upper()} mode — EXAM_BLOCKED enforced ({len(self.EXAM_BLOCKED)} processes), {len(self.whitelist)} processes whitelisted")
        else:
            print(f"[WhitelistEnforcer] Running in {self.mode.upper()} mode — EXAM_BLOCKED not enforced, {len(self.whitelist)} processes whitelisted")

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
        current_user = os.environ.get('USERNAME', '').lower()
        while self.running:
            # Only pause automatic killing & reporting during the pre-exam self-check phase
            if self.is_self_check:
                time.sleep(2.0)
                continue

            for proc in psutil.process_iter(['pid', 'name', 'username']):
                if not self.running:
                    break
                
                try:
                    pid = proc.info['pid']
                    name = proc.info['name']
                    
                    if not name:
                        continue
                        
                    name_lower = name.lower()
                    
                    # 1. Protect critical OS processes & hardware safety list
                    if name_lower in self.SAFETY_LIST:
                        continue
                        
                    # 2. Ignore known harmless background services, telemetry, drivers, and databases
                    if name_lower in self.KNOWN_BACKGROUND_SERVICES or name_lower.startswith("antigravitysetup"):
                        continue

                    # 3. Protect the AI module and its dev environment dynamically
                    if pid in self.protected_pids:
                        continue

                    # 4. Filter by process owner (must belong to the active logged-in candidate)
                    username = proc.info.get('username')
                    if not username:
                        try:
                            username = proc.username()
                        except (psutil.AccessDenied, psutil.NoSuchProcess):
                            # If psutil cannot query the username, it is a protected Windows service or elevated system daemon
                            continue
                            
                    if not username:
                        continue
                        
                    username_lower = username.lower()
                    
                    # Ignore Windows system/service accounts
                    if any(sys_acc in username_lower for sys_acc in [
                        'nt authority', 'local service', 'network service', 
                        'window manager', 'font driver host', 'system', 'umfd-', 'dwm-'
                    ]):
                        continue
                        
                    # Only enforce on processes owned by the current candidate's user session
                    if current_user and current_user not in username_lower:
                        continue
                        
                    # 5. Teacher allowed tools check (Takes precedence before EXAM_BLOCKED)
                    if name_lower in self.allowed_apps:
                        self._inspect_allowed_app(proc, name_lower)
                        continue

                    # 6. Exam Mode Hard Block
                    if self.mode == "exam" and name_lower in self.EXAM_BLOCKED:
                        # Fall through to handle_violation immediately, no exceptions
                        pass
                        
                    # 7. Allow whitelisted apps (uses exam_whitelist in exam mode, dev_whitelist in dev mode)
                    elif name_lower in self.whitelist:
                        continue

                    # If we reach here, it's an unauthorized application launched by the candidate
                    self._handle_violation(proc, name_lower)

                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    pass
                except Exception as e:
                    print(f"[WhitelistEnforcer] Unexpected error checking process: {e}")

            # Check for any pre-existing files accessed/opened during the exam session
            try:
                self._check_recent_opened_files()
            except Exception:
                pass

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
        screenshot_path = None
        try:
            screenshot_path = capture_screenshot(self.session_id, "unauthorized_app")
        except Exception as e:
            print(f"[WhitelistEnforcer] Warning: Could not capture screenshot: {e}")
        
        # Terminate gracefully, then force kill if needed, with Windows taskkill fallback
        killed = False
        try:
            proc.terminate()
            try:
                proc.wait(timeout=2.0)
                killed = True
            except psutil.TimeoutExpired:
                print(f"[WhitelistEnforcer] Process {name_lower} did not terminate gracefully. Force killing...")
                proc.kill()
                killed = True
        except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
            print(f"[WhitelistEnforcer] psutil could not terminate {name_lower} (PID: {pid}): {e}. Trying Windows taskkill fallback...")
            try:
                import subprocess
                res = subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
                if res.returncode == 0:
                    killed = True
                    print(f"[WhitelistEnforcer] Successfully terminated {name_lower} via taskkill.")
            except Exception as taskkill_err:
                print(f"[WhitelistEnforcer] taskkill fallback failed: {taskkill_err}")
        
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
        One-off check to list currently running non-whitelisted apps.
        Uses active mode (exam_whitelist vs dev_whitelist) and enforces EXAM_BLOCKED in exam mode.
        """
        config_path = os.path.join(os.path.dirname(__file__), 'config', 'whitelist.json')
        mode_whitelist = set()
        try:
            with open(config_path, 'r') as f:
                data = json.load(f)
                key = f"{self.mode}_whitelist"
                entries = data.get(key, [])
                mode_whitelist = {app.lower() for app in entries}
        except Exception as e:
            print(f"[WhitelistEnforcer] Error loading whitelist for check: {e}")
            
        unauthorized_apps = []
        current_user = os.environ.get('USERNAME', '').lower()
        window_titles = self._get_window_titles()
        seen_names = set()
        
        for proc in psutil.process_iter(['pid', 'name', 'username']):
            try:
                name = proc.info.get('name')
                pid = proc.info.get('pid')
                if not name or not pid: 
                    continue
                    
                name_lower = name.lower()
                if pid in self.protected_pids: 
                    continue
                if name_lower in self.SAFETY_LIST: 
                    continue
                if name_lower in self.KNOWN_BACKGROUND_SERVICES or name_lower.startswith("antigravitysetup"):
                    continue

                username = proc.info.get('username')
                if not username:
                    try:
                        username = proc.username()
                    except (psutil.AccessDenied, psutil.NoSuchProcess):
                        continue
                if not username:
                    continue
                    
                username_lower = username.lower()
                if any(sys_acc in username_lower for sys_acc in [
                    'nt authority', 'local service', 'network service', 
                    'window manager', 'font driver host', 'system', 'umfd-', 'dwm-'
                ]): 
                    continue
                    
                if current_user and current_user not in username_lower:
                    continue
                
                # Check teacher-permitted tools first (takes precedence)
                if name_lower in self.allowed_apps:
                    continue

                # In Exam mode, browsers and developer shells are strictly blocked
                if self.mode == "exam" and name_lower in self.EXAM_BLOCKED:
                    pass # Unauthorized! Fall through to record
                elif name_lower in mode_whitelist or name_lower in self.whitelist:
                    continue

                if name_lower in seen_names:
                    continue
                seen_names.add(name_lower)
                
                title = window_titles.get(pid)
                if not title:
                    friendly_names = {
                        "ai.exe": "Microsoft Office Copilot AI",
                        "ollama.exe": "Ollama Local LLM AI",
                        "ollama_llama_server.exe": "Ollama Llama Server",
                        "cmd.exe": "Command Prompt",
                        "powershell.exe": "Windows PowerShell",
                        "pwsh.exe": "PowerShell Core",
                        "wt.exe": "Windows Terminal",
                        "code.exe": "Visual Studio Code",
                        "chatgpt.exe": "ChatGPT Desktop App",
                        "discord.exe": "Discord",
                        "slack.exe": "Slack",
                        "telegram.exe": "Telegram",
                        "whatsapp.exe": "WhatsApp",
                        "chrome.exe": "Google Chrome",
                        "msedge.exe": "Microsoft Edge",
                        "firefox.exe": "Mozilla Firefox",
                        "brave.exe": "Brave Browser"
                    }
                    display_name = friendly_names.get(name_lower, name)
                    if display_name != name:
                        display_name = f"{display_name} ({name})"
                else:
                    display_name = f"{title} ({name})"
                unauthorized_apps.append({"name": name, "display": display_name})
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
            except Exception as e:
                print(f"[WhitelistEnforcer] Error inspecting process in check_running_apps: {e}")
                
        return unauthorized_apps
                
    def _resolve_lnk_target(self, lnk_path):
        """Resolve the actual Windows shortcut target, including Unicode paths."""
        if os.name != 'nt':
            return None
        import subprocess
        escaped_path = lnk_path.replace("'", "''")
        command = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        command += f"(New-Object -ComObject WScript.Shell).CreateShortcut('{escaped_path}').TargetPath"
        try:
            result = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', command],
                                    capture_output=True, encoding='utf-8', errors='replace', timeout=3,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            target = result.stdout.strip().lstrip('\ufeff')
            if result.returncode == 0 and os.path.isfile(target):
                return target
        except (OSError, subprocess.TimeoutExpired):
            pass
        return None

    def _check_recent_opened_files(self):
        """
        Monitors Windows Recent directory for any files opened during the active exam session.
        If an opened file was modified/created prior to the exam start time, it triggers a violation.
        """
        recent_dir = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Recent")
        if not os.path.isdir(recent_dir):
            return

        try:
            for item in os.listdir(recent_dir):
                if not item.lower().endswith(".lnk"):
                    continue
                
                lnk_path = os.path.join(recent_dir, item)
                try:
                    st = os.stat(lnk_path)
                    # Check if this shortcut access timestamp has already been processed
                    last_seen_mtime = self.seen_recent_shortcuts.get(lnk_path)
                    if last_seen_mtime is not None and st.st_mtime <= last_seen_mtime:
                        continue

                    # Check if this shortcut was created/accessed after the exam session started
                    if st.st_mtime >= (self.exam_start_time - 5.0):
                        # Immediately record shortcut mtime so it will NEVER trigger again for this access
                        self.seen_recent_shortcuts[lnk_path] = st.st_mtime

                        # Resolve real file directly from shortcut target
                        real_file = self._resolve_lnk_target(lnk_path)
                        if real_file and os.path.isfile(real_file):
                            _, ext = os.path.splitext(real_file.lower())
                            if ext in self.DOC_EXTENSIONS:
                                file_mtime = os.path.getmtime(real_file)
                                # If the file was modified/created prior to exam start
                                if file_mtime < (self.exam_start_time - 15.0):
                                    fname = os.path.basename(real_file)
                                    print(f"[WhitelistEnforcer] Detected pre-existing document accessed: {fname} (Path: {real_file})")
                                    app_target = "winword.exe" if ext in (".docx", ".doc", ".rtf") else "code.exe" if ext in (".py", ".cpp", ".c", ".java", ".js") else "document_viewer"
                                    self._handle_file_violation(None, app_target, f"Pre-existing notes/file opened: {fname}", file_path=real_file)
                                    return
                except (OSError, PermissionError):
                    continue
        except Exception as e:
            pass

    def _inspect_allowed_app(self, proc, name_lower):
        """
        Guards permitted external apps (e.g. Word, VS Code, Notepad) from opening
        pre-existing notes, solutions, or cheat sheets created before exam start.
        """
        try:
            # 1. Check open file handles for pre-existing documents
            try:
                open_files = proc.open_files()
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                open_files = []

            for f in open_files:
                fpath = f.path.lower()
                if any(ign in fpath for ign in self.IGNORE_DIRS):
                    continue
                _, ext = os.path.splitext(fpath)
                if ext in self.DOC_EXTENSIONS:
                    try:
                        mtime = os.path.getmtime(f.path)
                        # If file was modified/created prior to the exam session start
                        if mtime < (self.exam_start_time - 15.0):
                            fname = os.path.basename(f.path)
                            print(f"[WhitelistEnforcer] Flagged pre-existing file in {name_lower}: {fname}")
                            self._handle_file_violation(proc, name_lower, f"Pre-existing notes/file opened: {fname}", file_path=f.path)
                            return
                    except (OSError, PermissionError):
                        pass

        except Exception as e:
            print(f"[WhitelistEnforcer] File inspection unavailable for {name_lower}: {e}")

    def _handle_file_violation(self, proc, name_lower, reason, file_path=None):
        clean_file_name = os.path.basename(file_path) if file_path else (reason.split(":")[-1].strip() if ":" in reason else "")
        key = f"{name_lower}_{clean_file_name.lower()}_file_violation"
        now = time.time()

        # Capture evidence screenshot BEFORE terminating the application
        screenshot_path = None
        try:
            screenshot_path = capture_screenshot(self.session_id, "unauthorized_app")
        except Exception as e:
            print(f"[WhitelistEnforcer] Warning: Could not capture screenshot: {e}")

        # ALWAYS turn off / terminate the application immediately if an unauthorized file is opened
        terminated = False
        if proc:
            try:
                print(f"[WhitelistEnforcer] Terminating {name_lower} (PID: {proc.pid}) because a pre-existing file was opened.")
                proc.terminate()
                try:
                    proc.wait(timeout=1.5)
                    terminated = True
                except psutil.TimeoutExpired:
                    proc.kill()
                    terminated = True
            except Exception as e:
                print(f"[WhitelistEnforcer] Error terminating process {name_lower}: {e}")

        # If proc was None (e.g. from Recent shortcuts scan) or still alive, terminate running instances of name_lower
        if not terminated and name_lower and name_lower not in self.SAFETY_LIST:
            for p in psutil.process_iter(['name', 'pid']):
                try:
                    if p.info['name'] and p.info['name'].lower() == name_lower:
                        print(f"[WhitelistEnforcer] Terminating {name_lower} (PID: {p.pid}) due to pre-existing document access.")
                        p.terminate()
                        try:
                            p.wait(timeout=1.5)
                        except psutil.TimeoutExpired:
                            p.kill()
                        terminated = True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

        # Windows taskkill fallback to guarantee the unauthorized document window is turned off
        if name_lower and name_lower in ("winword.exe", "word.exe", "code.exe"):
            try:
                import subprocess
                subprocess.run(["taskkill", "/F", "/IM", name_lower], capture_output=True)
            except Exception:
                pass

        # Debounce alert payload during immediate process teardown (10s window)
        # If the candidate reopens the file after 10s, a new violation alert will fire
        if key in self.violation_counts and (now - self.violation_counts[key]) < 10.0:
            return
        self.violation_counts[key] = now

        payload = {
            "sessionId": self.session_id,
            "type": "unauthorized_app",
            "severity": 4,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "details": {
                "object_class": name_lower,
                "reason": reason,
                "fileName": clean_file_name,
                "filePath": file_path or "",
                "action": "file_closed_require_new"
            }
        }
        if screenshot_path:
            payload["screenshotPath"] = screenshot_path

        if self.on_violation_callback:
            try:
                self.on_violation_callback(payload)
            except Exception as e:
                print(f"[WhitelistEnforcer] Error sending file violation callback: {e}")


