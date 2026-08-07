import mss
import mss.tools
from PIL import Image
import os
import time
import io
from datetime import datetime, timezone

SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')
MAX_SIZE_KB = 200
MAX_SIZE_BYTES = MAX_SIZE_KB * 1024

def _cleanup_old_screenshots():
    if not os.path.exists(SCREENSHOT_DIR):
        os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    
    try:
        now = time.time()
        for filename in os.listdir(SCREENSHOT_DIR):
            file_path = os.path.join(SCREENSHOT_DIR, filename)
            if os.path.isfile(file_path):
                # Delete files older than 24 hours
                if os.stat(file_path).st_mtime < now - 86400:
                    os.remove(file_path)
    except Exception as e:
        print(f"[ScreenshotCapture] Failed to clean up old screenshots: {e}")

def capture_screenshot(session_id, violation_type):
    """
    Captures the full screen, compresses it to JPEG (targeting <200KB),
    and saves it to the local screenshots directory.
    Returns the absolute path to the saved image, or None if failed.
    """
    try:
        _cleanup_old_screenshots()
        
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = f"{session_id}_{violation_type}_{timestamp}.jpg"
        filepath = os.path.join(SCREENSHOT_DIR, filename)

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
                final_quality = q # Use the lowest tried if still exceeds

            # Save the final buffer to file
            with open(filepath, 'wb') as f:
                f.write(buffer.getvalue())
            
            kb_size = len(buffer.getvalue()) // 1024
            print(f"[ScreenshotCapture] Saved screenshot {filename} at quality {final_quality} ({kb_size} KB)")
            return filepath
            
    except Exception as e:
        print(f"[ScreenshotCapture] Error capturing screenshot: {e}")
        return None
