"""
Capture Service Module

IntegrityFlow uses the Strategy/Provider pattern for evidence capture during proctoring sessions:
- MssCaptureProvider: Desktop screenshot capture (used for unauthorized applications/process violations).
- WebcamCaptureProvider: Camera frame capture (used for cell phones, looking away, multiple persons).
"""

from .CaptureProvider import CaptureProvider
from .MssCaptureProvider import MssCaptureProvider
from .WebcamCaptureProvider import WebcamCaptureProvider

# Active default providers
desktop_capture_provider = MssCaptureProvider()
webcam_capture_provider = WebcamCaptureProvider()

# Default alias
capture_provider = desktop_capture_provider

def capture_screenshot(session_id: str, violation_type: str):
    """
    Captures the desktop screen (for OS/process violations).
    """
    return desktop_capture_provider.capture(session_id, violation_type)

def capture_webcam_frame(session_id: str, violation_type: str, frame=None):
    """
    Captures the active webcam frame (for camera/AI violations like cell phones, multiple faces, head turn).
    """
    return webcam_capture_provider.capture(session_id, violation_type, frame=frame)

__all__ = [
    "CaptureProvider",
    "MssCaptureProvider",
    "WebcamCaptureProvider",
    "capture_provider",
    "desktop_capture_provider",
    "webcam_capture_provider",
    "capture_screenshot",
    "capture_webcam_frame"
]
