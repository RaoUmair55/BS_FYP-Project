import os
import time
import io
from datetime import datetime, timezone
from typing import Optional
import mss
import mss.tools
from PIL import Image

from .CaptureProvider import CaptureProvider

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCREENSHOT_DIR = os.path.join(BASE_DIR, 'screenshots')
MAX_SIZE_KB = 200
MAX_SIZE_BYTES = MAX_SIZE_KB * 1024


class MssCaptureProvider(CaptureProvider):
    """
    Desktop screen capture implementation using the 'mss' library.
    Captures full screen across monitors, compresses to JPEG (<200KB),
    and saves to the local screenshots directory with microsecond timestamps.
    """

    def __init__(self, screenshot_dir: str = SCREENSHOT_DIR):
        self.screenshot_dir = screenshot_dir
        self._ensure_directory()

    def _ensure_directory(self):
        if not os.path.exists(self.screenshot_dir):
            os.makedirs(self.screenshot_dir, exist_ok=True)

    def _cleanup_old_screenshots(self):
        self._ensure_directory()
        try:
            now = time.time()
            for filename in os.listdir(self.screenshot_dir):
                file_path = os.path.join(self.screenshot_dir, filename)
                if os.path.isfile(file_path):
                    # Delete files older than 24 hours
                    if os.stat(file_path).st_mtime < now - 86400:
                        os.remove(file_path)
        except Exception as e:
            print(f"[MssCaptureProvider] Failed to clean up old screenshots: {e}")

    def capture(self, session_id: str, violation_type: str) -> Optional[str]:
        """
        Captures the full screen, compresses it to JPEG (targeting <200KB),
        and saves it to the local screenshots directory.
        Returns the absolute path to the saved image, or None if failed.
        """
        try:
            self._cleanup_old_screenshots()

            timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            filename = f"{session_id}_{violation_type}_{timestamp}.jpg"
            filepath = os.path.join(self.screenshot_dir, filename)

            with mss.mss() as sct:
                # Monitor 0 is all monitors combined
                monitor = sct.monitors[0]
                sct_img = sct.grab(monitor)

                # Convert to PIL Image
                img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")

                # Step down quality until file is under MAX_SIZE_BYTES
                qualities = [70, 50, 30, 15]
                final_quality = 70
                buffer = io.BytesIO()

                for q in qualities:
                    buffer.seek(0)
                    buffer.truncate(0)
                    img.save(buffer, format="JPEG", quality=q, optimize=True)
                    size = buffer.tell()
                    if size <= MAX_SIZE_BYTES:
                        final_quality = q
                        break
                    final_quality = q  # Use the lowest tried if still exceeds

                # Save the final buffer to file
                with open(filepath, 'wb') as f:
                    f.write(buffer.getvalue())

                kb_size = len(buffer.getvalue()) // 1024
                print(f"[MssCaptureProvider] Saved screenshot {filename} at quality {final_quality} ({kb_size} KB)")
                return os.path.abspath(filepath)

        except Exception as e:
            print(f"[MssCaptureProvider] Error capturing screenshot: {e}")
            return None
