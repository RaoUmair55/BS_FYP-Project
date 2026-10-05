# IntegrityFlow file overview
# Purpose: Webcam-frame evidence implementation.
# How it works: Saves the supplied camera frame as a timestamped JPEG and reduces quality toward the configured size target. Falls back to desktop capture when no frame is supplied.
# Connection: Returns its local path for later upload; capture failures return None.
import os
import time
from datetime import datetime, timezone
from typing import Optional, Any
import cv2

from .CaptureProvider import CaptureProvider

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCREENSHOT_DIR = os.path.join(BASE_DIR, 'screenshots')
MAX_SIZE_KB = 200
MAX_SIZE_BYTES = MAX_SIZE_KB * 1024


class WebcamCaptureProvider(CaptureProvider):
    """
    Evidence capture implementation for webcam camera video frames.
    Saves the active camera frame (with optional detection bounding boxes)
    as a JPEG (<200KB) to the screenshots evidence directory with microsecond timestamps.
    """

    def __init__(self, screenshot_dir: str = SCREENSHOT_DIR):
        self.screenshot_dir = screenshot_dir
        self._ensure_directory()

    def _ensure_directory(self):
        if not os.path.exists(self.screenshot_dir):
            os.makedirs(self.screenshot_dir, exist_ok=True)

    def capture(self, session_id: str, violation_type: str, frame: Optional[Any] = None) -> Optional[str]:
        """
        Saves the provided webcam frame to the evidence folder.
        If frame is None, falls back to desktop screen capture.
        """
        try:
            self._ensure_directory()

            if frame is None:
                # Fallback to desktop screen capture if no frame was passed
                from .MssCaptureProvider import MssCaptureProvider
                return MssCaptureProvider(self.screenshot_dir).capture(session_id, violation_type)

            timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            filename = f"{session_id}_{violation_type}_{timestamp}.jpg"
            filepath = os.path.join(self.screenshot_dir, filename)

            # Step down JPEG quality from 85 -> 65 -> 45 -> 25 to guarantee <200KB
            qualities = [85, 65, 45, 25]
            encoded_bytes = None
            final_q = 85

            for q in qualities:
                encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), q]
                result, enc_img = cv2.imencode('.jpg', frame, encode_param)
                if result:
                    encoded_bytes = enc_img.tobytes()
                    final_q = q
                    if len(encoded_bytes) <= MAX_SIZE_BYTES:
                        break

            if encoded_bytes is None:
                return None

            with open(filepath, 'wb') as f:
                f.write(encoded_bytes)

            kb_size = len(encoded_bytes) // 1024
            print(f"[WebcamCaptureProvider] Saved webcam evidence {filename} at quality {final_q} ({kb_size} KB)")
            return os.path.abspath(filepath)

        except Exception as e:
            print(f"[WebcamCaptureProvider] Error capturing webcam frame: {e}")
            return None
