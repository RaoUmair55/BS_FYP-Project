import threading
import time
from datetime import datetime, timezone
import mss
import screenshot_capture

class AIMonitor:
    """
    Hardware and environmental monitoring.
    Currently implements Multiple Monitor detection.
    """
    def __init__(self, session_id, on_violation_callback):
        self.session_id = session_id
        self.on_violation_callback = on_violation_callback
        self.running = False
        self.monitor_thread = None
        self.has_fired_violation = False

    def start(self):
        if not self.running:
            self.running = True
            self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
            self.monitor_thread.start()
            print("[AIMonitor] Hardware monitoring started.")

    def stop(self):
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=2)
            print("[AIMonitor] Hardware monitoring stopped.")

    def _monitor_loop(self):
        with mss.mss() as sct:
            while self.running:
                try:
                    # In mss, monitors[0] is a virtual monitor encompassing all physical monitors.
                    # monitors[1] is the primary, monitors[2] is secondary, etc.
                    # So if len(monitors) > 2, there is more than 1 physical display connected.
                    num_physical_monitors = len(sct.monitors) - 1
                    
                    if num_physical_monitors > 1 and not self.has_fired_violation:
                        print(f"[AIMonitor] Detected {num_physical_monitors} monitors! Triggering violation.")
                        
                        # Take a screenshot
                        screenshot_path = screenshot_capture.take_screenshot(
                            self.session_id, 
                            "multiple_monitors", 
                            quality=60
                        )
                        
                        payload = {
                            "sessionId": self.session_id,
                            "type": "multiple_monitors",
                            "severity": 4, # High severity for cheating via second screen
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "details": {
                                "monitor_count": num_physical_monitors
                            },
                            "screenshotPath": screenshot_path
                        }
                        self.on_violation_callback(payload)
                        self.has_fired_violation = True
                        
                    elif num_physical_monitors == 1:
                        # Reset flag if they unplugged the monitor, so we can detect it again later
                        self.has_fired_violation = False
                        
                except Exception as e:
                    print(f"[AIMonitor] Error checking monitors: {e}")
                
                time.sleep(5) # Check every 5 seconds
