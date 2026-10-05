# IntegrityFlow file overview
# Purpose: Common interface for visual evidence providers.
# How it works: Defines the abstract capture method: receive a session and violation type, 
# then return the saved evidence path or None.
# Connection: Implemented by the MSS desktop provider and webcam-frame provider.
from abc import ABC, abstractmethod
from typing import Optional

class CaptureProvider(ABC):
    """
    Abstract Base Class for Evidence Capture Providers.
    Any capture mechanism (MSS desktop capture, webcam frame capture, direct cloud uploader)
    must inherit from this base class and implement the capture method.
    """

    @abstractmethod
    def capture(self, session_id: str, violation_type: str) -> Optional[str]:
        """
        Captures evidence (e.g. screen snapshot, webcam frame) associated with a violation.
        
        :param session_id: The active exam session ID
        :param violation_type: The type/category of violation detected
        :return: Absolute file path to the saved capture, or None if failed
        """
        pass
