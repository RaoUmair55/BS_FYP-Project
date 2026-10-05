# IntegrityFlow file overview
# Purpose: Checks and monitors removable USB storage.
# How it works: Inspects attached storage devices and
# polls for removable-storage activity; reports detection/query problems
# and emits exam violations through a callback.
# Connection: Used by server.py for self-check and by main.py for continuous
# exam monitoring;
# this is about storage devices, not every USB peripheral.
import threading
import time
import os
import ctypes
from datetime import datetime, timezone
import psutil

# Windows Drive Type Constants
DRIVE_UNKNOWN = 0
DRIVE_NO_ROOT_DIR = 1
DRIVE_REMOVABLE = 2  # Floppy, USB Flash drive, SD Card
DRIVE_FIXED = 3      # Hard drive, SSD
DRIVE_REMOTE = 4     # Network drive
DRIVE_CDROM = 5      # Optical drive
DRIVE_RAMDISK = 6

class USBMonitor:
    """
    Monitors for removable mass storage devices (USB flash drives, external hard drives)
    using logical disk volume inspection.
    
    IMPORTANT DESIGN CONSTRAINT:
    This detects mounted removable storage volumes ONLY. Generic USB peripherals like
    wired mice, keyboards, webcams, and audio interfaces are Human Interface Devices (HID)
    or media classes that never mount as drive letters and are structurally excluded.
    """
    def __init__(self, session_id, on_violation_callback, is_self_check=False):
        self.session_id = session_id
        self.on_violation_callback = on_violation_callback
        self.is_self_check = is_self_check
        self.running = False
        self.monitor_thread = None
        self.reported_drives = set()
        self.last_error = None

    def get_removable_drives(self):
        """
        Returns a list of currently connected USB physical mass storage devices.
        Uses Windows CIM Win32_DiskDrive where InterfaceType='USB'.
        Runs cleanly without hangs on unmounted card reader slots or empty drive letters.
        """
        import subprocess
        import json

        # UASP disks can report a SCSI interface; Storage CIM BusType 7 identifies USB.
        # Query CIM directly to avoid slow Get-Disk module loading; preserve legacy fallback.
        ps_script = "$ErrorActionPreference = 'Stop'; $usbNumbers = @(); try { $usbNumbers = @(Get-CimInstance -Namespace root/Microsoft/Windows/Storage -ClassName MSFT_Disk -OperationTimeoutSec 2 -ErrorAction Stop | Where-Object { $_.BusType -eq 7 } | Select-Object -ExpandProperty Number) } catch {}; $disks = Get-CimInstance Win32_DiskDrive | Where-Object { ($_.InterfaceType -eq 'USB' -or $usbNumbers -contains $_.Index) -and $_.Size -gt 0 }; if ($disks) { $disks | Select-Object DeviceID, Model, Size, Caption | ConvertTo-Json -Compress } else { '[]' }"
        try:
            res = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True,
                text=True,
                timeout=5.0,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            if res.returncode != 0:
                raise RuntimeError('Windows USB enumeration failed. Retry the USB check.')
            self.last_error = None
            out = res.stdout.strip()
            if not out or out == '[]':
                return []
            data = json.loads(out)
            if isinstance(data, dict):
                data = [data]
            results = []
            for d in data:
                name = d.get("Model") or d.get("Caption") or "USB Flash Drive"
                dev_id = d.get("DeviceID", "USB Disk")
                results.append({
                    "device": dev_id,
                    "mountpoint": dev_id,
                    "label": name,
                    "fstype": "USB Mass Storage"
                })
            return results
        except Exception as e:
            self.last_error = f'USB scan unavailable: {e}'
            print(f"[USBMonitor] Drive enumeration error: {e}")
            return []

    def check_for_existing_removable_drives(self):
        """
        One-off check used during Self-Check to list currently connected removable storage.
        """
        return self.get_removable_drives()

    def start(self):
        """Starts background continuous monitoring thread."""
        self.running = True
        self.reported_drives.clear()

        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        print(f"[USBMonitor] Started USB removable storage monitor loop (is_self_check={self.is_self_check}).")

    def stop(self):
        """Stops background monitoring loop."""
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=3.0)
        print("[USBMonitor] Stopped USB removable storage monitor loop.")

    def _monitor_loop(self):
        while self.running:
            # During self-check, continuous violations are paused (one-time checks used instead)
            if self.is_self_check:
                time.sleep(3.0)
                continue

            try:
                current_drives = self.get_removable_drives()
                if self.last_error:
                    time.sleep(3.0)
                    continue
                self._report_connected_drives(current_drives)
            except Exception as e:
                print(f"[USBMonitor] Error during monitor loop poll: {e}")

            time.sleep(3.0)

    def _report_connected_drives(self, current_drives):
        current = {d['device'].upper(): d for d in current_drives if d.get('device')}
        self.reported_drives.intersection_update(current)
        for key in current.keys() - self.reported_drives:
            self._handle_violation(current[key])
            self.reported_drives.add(key)

    def _handle_violation(self, drive_info):
        device = drive_info.get("device", "Unknown Drive")
        label = drive_info.get("label", "Removable Storage")
        print(f"[USBMonitor] USB removable storage detected during exam: {device} ({label})")

        # Capture evidence screenshot
        screenshot_path = None
        try:
            from services.capture import capture_screenshot
            screenshot_path = capture_screenshot(self.session_id, "usb_device_detected")
        except Exception as e:
            print(f"[USBMonitor] Warning: Could not capture screenshot: {e}")

        payload = {
            "sessionId": self.session_id,
            "type": "usb_device_detected",
            "severity": 4,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "details": {
                "object_class": "removable_storage",
                "device": device,
                "mountpoint": drive_info.get("mountpoint", device),
                "label": label,
                "fstype": drive_info.get("fstype", "")
            }
        }

        if screenshot_path:
            payload["screenshotPath"] = screenshot_path

        try:
            if self.on_violation_callback:
                self.on_violation_callback(payload)
        except Exception as e:
            print(f"[USBMonitor] Error dispatching USB violation: {e}")
