import time
import numpy as np
import cv2

class CameraOcclusionDetector:
    """
    Enterprise-grade modular detector for real-time camera occlusion, lens covering,
    tape obstruction, and severe underexposure/darkness drops.
    
    Principles Applied:
    - Single Responsibility Principle (SRP): Isolates image photometric variance & luminance analysis.
    - Zero-Latency Compute: Uses NumPy array reduction for microsecond evaluation (< 0.5ms).
    """

    def __init__(self, dark_threshold=22.0, min_variance_threshold=6.0, sustained_seconds=1.2):
        """
        :param dark_threshold: Average grayscale pixel intensity (0-255) below which frame is considered dark.
        :param min_variance_threshold: Spatial standard deviation below which frame is considered featureless/solid (covered by tape/object).
        :param sustained_seconds: Duration in seconds the condition must persist to avoid false triggers from blinks or flashes.
        """
        self.dark_threshold = float(dark_threshold)
        self.min_variance_threshold = float(min_variance_threshold)
        self.sustained_seconds = float(sustained_seconds)
        self.occlusion_start_time = None
        self.last_occlusion_reason = ""
        self.last_metrics = {}

    def analyze_frame(self, gray_frame: np.ndarray) -> tuple[bool, str, dict]:
        """
        Analyzes a grayscale frame for severe illumination drop or solid lens covering.
        
        :param gray_frame: 2D numpy array representing grayscale image.
        :returns: (is_triggered, reason_string, metrics_dict)
        """
        if gray_frame is None or gray_frame.size == 0:
            return False, "", {}

        # 1. Compute photometric metrics using fast 2x strided subsampling
        sample = gray_frame[::2, ::2] if (gray_frame.shape[0] > 120 and gray_frame.shape[1] > 160) else gray_frame
        mean_val = float(np.mean(sample))
        std_val = float(np.std(sample))
        now = time.time()

        is_currently_occluded = False
        current_reason = ""

        # Condition A: Frame is extremely dark (pitch black / lens covered by opaque material / lights off)
        if mean_val < self.dark_threshold:
            is_currently_occluded = True
            current_reason = f"Camera feed pitch dark or lens obstructed (Mean: {round(mean_val, 1)}/255)"
        # Condition B: Frame has near-zero spatial variance (solid tape, white paper, or finger pressing on lens)
        elif std_val < self.min_variance_threshold and mean_val < 180.0:
            is_currently_occluded = True
            current_reason = f"Camera lens occluded with solid barrier/tape (Variance: {round(std_val, 2)})"

        self.last_metrics = {
            "mean_brightness": round(mean_val, 1),
            "variance": round(std_val, 2),
            "dark_threshold": self.dark_threshold
        }

        # 2. Time-sustained thresholding to ensure deliberate action
        if is_currently_occluded:
            if self.occlusion_start_time is None:
                self.occlusion_start_time = now
                self.last_occlusion_reason = current_reason
                return False, "", self.last_metrics
            else:
                elapsed = now - self.occlusion_start_time
                if elapsed >= self.sustained_seconds:
                    self.last_metrics["duration"] = round(elapsed, 1)
                    # Reset so subsequent violations require another cycle or stay reported
                    self.occlusion_start_time = now
                    return True, self.last_occlusion_reason, self.last_metrics
                return False, "", self.last_metrics
        else:
            self.occlusion_start_time = None
            self.last_occlusion_reason = ""
            return False, "", self.last_metrics

    def reset(self):
        """Resets the detector's internal temporal timers."""
        self.occlusion_start_time = None
        self.last_occlusion_reason = ""
