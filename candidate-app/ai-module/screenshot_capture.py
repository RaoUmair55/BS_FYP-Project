"""
Screenshot Capture Module (Compatibility Layer)
Delegates to the modular CaptureProvider architecture in services/capture.
"""

from services.capture import capture_screenshot, capture_provider, CaptureProvider, MssCaptureProvider

__all__ = [
    "capture_screenshot",
    "capture_provider",
    "CaptureProvider",
    "MssCaptureProvider"
]
