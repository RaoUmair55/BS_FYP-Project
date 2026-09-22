import threading
import time
import os
import ctypes
from datetime import datetime, timezone
import psutil
from services.capture import capture_screenshot

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
        self.known_drives = set()
        
        # Initialize baseline of currently connected removable drives
        try:
            initial = self.get_removable_drives()
            self.known_drives = {d.get("device", "").upper() for d in initial if d.get("device")}
        except Exception:
            self.known_drives = set()

    def _get_volume_label(self, drive_path):
        """Retrieves the volume name/label for a given drive letter (e.g. 'E:\\')."""
        try:
            kernel32 = ctypes.windll.kernel32
            volume_name_buffer = ctypes.create_unicode_buffer(1024)
            fs_name_buffer = ctypes.create_unicode_buffer(1024)
            serial_number = ctypes.c_ulong()
            max_component_length = ctypes.c_ulong()
            file_system_flags = ctypes.c_ulong()

            res = kernel32.GetVolumeInformationW(
                ctypes.c_wchar_p(drive_path),
                volume_name_buffer,
                ctypes.sizeof(volume_name_buffer),
                ctypes.byref(serial_number),
                ctypes.byref(max_component_length),
                ctypes.byref(file_system_flags),
                fs_name_buffer,
                ctypes.sizeof(fs_name_buffer)
            )
            if res:
                return volume_name_buffer.value or "Removable Disk"
        except Exception:
            pass
        return "Removable Disk"

    def get_removable_drives(self):
        """
        Returns a list of currently mounted removable mass storage devices.
        Uses psutil, Windows Win32 API GetDriveTypeW (DriveType == 2), and WMI cross-check.
        """
        removable_drives = []
        seen_devices = set()

        # Method 1: Cross-check via WMI Win32_LogicalDisk if available
        wmi_removable_letters = set()
        try:
            import pythoncom
            pythoncom.CoInitialize()
            try:
                import wmi
                c = wmi.WMI()
                for disk in c.Win32_LogicalDisk(DriveType=2): # 2 = Removable disk
                    dev_id = disk.DeviceID
                    if dev_id:
                        wmi_removable_letters.add(dev_id.upper().rstrip('\\') + '\\')
                c = None
            except Exception:
                pass
            finally:
                pythoncom.CoUninitialize()
        except Exception:
            # WMI optional / fallback
            pass

        # Method 2: Inspect psutil partitions and Windows kernel32 GetDriveTypeW
        try:
            partitions = psutil.disk_partitions(all=False)
        except Exception:
            partitions = []

        for p in partitions:
            mount = p.mountpoint
            if not mount:
                continue
            mount_norm = mount.upper()
            if not mount_norm.endswith('\\'):
                mount_norm += '\\'

            is_removable = False

            # Check WMI list
            if mount_norm in wmi_removable_letters:
                is_removable = True

            # Check psutil mount opts
            if 'removable' in getattr(p, 'opts', '').lower():
                is_removable = True

            # Check Windows GetDriveTypeW
            try:
                drive_type = ctypes.windll.kernel32.GetDriveTypeW(mount_norm)
                if drive_type == DRIVE_REMOVABLE:
                    is_removable = True
            except Exception:
                pass

            if is_removable and mount_norm not in seen_devices:
                seen_devices.add(mount_norm)
                label = self._get_volume_label(mount_norm)
                removable_drives.append({
                    "device": mount_norm,
                    "mountpoint": mount_norm,
                    "label": label,
                    "fstype": p.fstype or "FAT32"
                })

        # Method 3: Direct drive letter scan (A-Z) fallback with GetDriveTypeW
        for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
            drive_path = f"{letter}:\\"
            if drive_path in seen_devices:
                continue
            try:
                dtype = ctypes.windll.kernel32.GetDriveTypeW(drive_path)
                if dtype == DRIVE_REMOVABLE or drive_path in wmi_removable_letters:
                    seen_devices.add(drive_path)
                    label = self._get_volume_label(drive_path)
                    removable_drives.append({
                        "device": drive_path,
                        "mountpoint": drive_path,
                        "label": label,
                        "fstype": "Removable"
                    })
            except Exception:
                pass

        return removable_drives

    def check_for_existing_removable_drives(self):
        """
        One-off check used during Self-Check to list currently connected removable storage.
        """
        return self.get_removable_drives()

    def start(self):
        """Starts background continuous monitoring thread."""
        self.running = True
        # Re-sync baseline on start
        try:
            initial = self.get_removable_drives()
            self.known_drives = {d.get("device", "").upper() for d in initial if d.get("device")}
        except Exception:
            self.known_drives = set()

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
                current_drive_map = {d.get("device", "").upper(): d for d in current_drives if d.get("device")}
                
                # Check for any new removable drives that were connected
                new_drive_keys = set(current_drive_map.keys()) - self.known_drives

                # In exam mode, ANY connected removable drive is a violation
                drives_to_report = []
                if new_drive_keys:
                    for key in new_drive_keys:
                        drives_to_report.append(current_drive_map[key])
                elif current_drive_map and not self.is_self_check:
                    # If any removable drives remain plugged in during active exam
                    for key, drive in current_drive_map.items():
                        drives_to_report.append(drive)

                if drives_to_report:
                    for drive in drives_to_report:
                        self._handle_violation(drive)

                # Update baseline
                self.known_drives = set(current_drive_map.keys())
            except Exception as e:
                print(f"[USBMonitor] Error during monitor loop poll: {e}")

            time.sleep(3.0)

    def _handle_violation(self, drive_info):
        device = drive_info.get("device", "Unknown Drive")
        label = drive_info.get("label", "Removable Storage")
        print(f"[USBMonitor] USB removable storage detected during exam: {device} ({label})")

        # Capture evidence screenshot
        screenshot_path = None
        try:
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
