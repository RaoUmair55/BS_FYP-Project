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
import sys
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
    This detects physical USB storage disks, including unmounted disks. Generic USB peripherals like
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
        ps_script = """$ErrorActionPreference = 'Stop';
        $storage = @(); try { $storage = @(Get-CimInstance -Namespace root/Microsoft/Windows/Storage -ClassName MSFT_Disk -OperationTimeoutSec 2 -ErrorAction Stop) } catch {};
        $usbNumbers = @($storage | Where-Object { $_.BusType -eq 7 } | Select-Object -ExpandProperty Number);
        $disks = @(Get-CimInstance Win32_DiskDrive | Where-Object { ($_.InterfaceType -eq 'USB' -or $usbNumbers -contains $_.Index) -and $_.Size -gt 0 });
        $result = @($disks | ForEach-Object {
            $disk = $_; $known = @($storage | Where-Object { $_.Number -eq $disk.Index });
            $volumesKnown = $true; try { $letters = @(Get-CimAssociatedInstance -InputObject $disk -Association Win32_DiskDriveToDiskPartition | ForEach-Object {
                Get-CimAssociatedInstance -InputObject $_ -Association Win32_LogicalDiskToPartition | Select-Object -ExpandProperty DeviceID
            }) } catch { $volumesKnown = $false; $letters = @() };
            [PSCustomObject]@{ DeviceID=$disk.DeviceID; Model=$disk.Model; Caption=$disk.Caption; PNPDeviceID=$disk.PNPDeviceID;
                DriveLetters=$letters; EjectionAllowed=($volumesKnown -and $known.Count -eq 1 -and $known[0].IsBoot -eq $false -and $known[0].IsSystem -eq $false) }
        }); if ($result.Count) { ConvertTo-Json -InputObject $result -Compress } else { '[]' }"""
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
                    "fstype": "USB Mass Storage",
                    "pnpDeviceId": d.get('PNPDeviceID'),
                    "driveLetters": d.get('DriveLetters') or [],
                    "ejectionAllowed": d.get('EjectionAllowed') is True
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
        if self.is_self_check:
            return
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

        captured_at = datetime.now(timezone.utc).isoformat()
        ejection = self._eject_storage(drive_info)
        print(f'[USBMonitor] Safe-ejection result for {device}: {ejection}')
        payload = {
            "sessionId": self.session_id,
            "type": "usb_device_detected",
            "severity": 4,
            "timestamp": captured_at,
            "details": {
                "object_class": "removable_storage",
                "device": device,
                "mountpoint": drive_info.get("mountpoint", device),
                "label": label,
                "fstype": drive_info.get("fstype", ""),
                "ejection": ejection
            }
        }

        if screenshot_path:
            payload["screenshotPath"] = screenshot_path

        try:
            if self.on_violation_callback:
                self.on_violation_callback(payload)
        except Exception as e:
            print(f"[USBMonitor] Error dispatching USB violation: {e}")

    def _eject_storage(self, drive_info):
        """Ask Windows for safe removal of this disk only; honour vetoes, never force removal."""
        if self.is_self_check or os.name != 'nt':
            return {'status': 'skipped', 'reason': 'Ejection runs only during a Windows exam'}
        if not drive_info.get('ejectionAllowed') or not drive_info.get('pnpDeviceId'):
            return {'status': 'skipped', 'reason': 'Safe non-system disk identity could not be verified'}
        protected = {os.path.splitdrive(path)[0].upper() for path in
                     [__file__, sys.executable, os.getcwd(), os.environ.get('APPDATA', ''),
                      os.environ.get('LOCALAPPDATA', ''), os.environ.get('WINDIR', '')] if path}
        letters = drive_info.get('driveLetters') or []
        if isinstance(letters, str):
            letters = [letters]
        if protected.intersection(str(letter).upper().rstrip('\\/') for letter in letters):
            return {'status': 'skipped', 'reason': 'Disk hosts Windows, the application or local application data'}
        try:
            from ctypes import wintypes
            cfg = ctypes.WinDLL('cfgmgr32')
            locate = cfg.CM_Locate_DevNodeW
            locate.argtypes = [ctypes.POINTER(wintypes.DWORD), wintypes.LPWSTR, wintypes.ULONG]
            locate.restype = wintypes.ULONG
            eject = cfg.CM_Request_Device_EjectW
            eject.argtypes = [wintypes.DWORD, ctypes.POINTER(ctypes.c_int), wintypes.LPWSTR, wintypes.ULONG, wintypes.ULONG]
            eject.restype = wintypes.ULONG
            node = wintypes.DWORD()
            result = locate(ctypes.byref(node), drive_info['pnpDeviceId'], 0)
            if result:
                return {'status': 'failed', 'reason': 'Device lookup failed', 'windowsCode': int(result)}
            veto = ctypes.c_int()
            name = ctypes.create_unicode_buffer(260)
            result = eject(node.value, ctypes.byref(veto), name, len(name), 0)
            # Some USB disks cannot eject their disk child node. Retry only the
            # direct storage-driver parent, never a hub or composite controller.
            if result and veto.value == 8:
                parent = wintypes.DWORD()
                get_parent = cfg.CM_Get_Parent
                get_parent.argtypes = [ctypes.POINTER(wintypes.DWORD), wintypes.DWORD, wintypes.ULONG]
                get_parent.restype = wintypes.ULONG
                property_fn = cfg.CM_Get_DevNode_Registry_PropertyW
                property_fn.argtypes = [wintypes.DWORD, wintypes.ULONG, ctypes.POINTER(wintypes.ULONG),
                                        ctypes.c_void_p, ctypes.POINTER(wintypes.ULONG), wintypes.ULONG]
                property_fn.restype = wintypes.ULONG
                service = ctypes.create_unicode_buffer(260)
                size = wintypes.ULONG(ctypes.sizeof(service))
                kind = wintypes.ULONG()
                if (get_parent(ctypes.byref(parent), node.value, 0) == 0 and
                    property_fn(parent.value, 5, ctypes.byref(kind), service, ctypes.byref(size), 0) == 0 and
                    service.value.casefold() in ('usbstor', 'uaspstor')):
                    veto.value = 0
                    name.value = ''
                    result = eject(parent.value, ctypes.byref(veto), name, len(name), 0)
            if result:
                return {'status': 'failed', 'reason': 'Windows refused safe removal',
                        'windowsCode': int(result), 'vetoType': veto.value, 'vetoName': name.value}
            return {'status': 'safe_removal_accepted'}
        except (OSError, AttributeError, TypeError) as exc:
            return {'status': 'failed', 'reason': str(exc)}
