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
