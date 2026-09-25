import cv2
import time
import json
import numpy as np
import mediapipe as mp
import onnxruntime as ort
import os
from datetime import datetime, timezone
from typing import Callable, Optional
from services.lighting_occlusion_detector import CameraOcclusionDetector

# Standard 80-class COCO list
COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
    "toothbrush"
]

class AIMonitor:
    """
    AI Exam Monitoring Module.
    
    Runs as a background process to monitor a student via webcam during an exam.
    Detects head turns, missing faces, multiple faces, and unauthorized objects (cell phone, book).
    Emits violations that match the standard team schema.
    """

    def __init__(self, session_id: str, on_violation: Optional[Callable] = None, on_violation_callback: Optional[Callable] = None):
        """
        Initializes the AIMonitor with session details, configuration, and ML models.
        """
        self.session_id = session_id
        self.on_violation = on_violation or on_violation_callback
        self.is_active = False
        self.running = False
        self.frame_count = 0
        self.head_turn_start = None
        self.lateral_turn_start = None
        self.downward_gaze_start = None
        self.no_face_start = None
        self.second_person_counter = 0
        self.mp_face_mesh = None
        self.ort_session = None
        self.occlusion_detector = CameraOcclusionDetector(dark_threshold=22.0, min_variance_threshold=6.0, sustained_seconds=1.2)
        self.last_occlusion_violation_at = 0

        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        try:
            # Load configuration
            config_path = os.path.join(base_dir, "config", "thresholds.json")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    self.thresholds = json.load(f)
            else:
                self.thresholds = {
                    "yaw_threshold_degrees": 28,
                    "sustained_lateral_seconds": 1.5,
                    "sustained_downward_seconds": 2.0,
                    "object_detection_confidence": 0.5
                }
                
            # Setup MediaPipe Face Mesh if available
            try:
                import mediapipe.python.solutions.face_mesh as mp_fm
                self.mp_face_mesh = mp_fm.FaceMesh(
                    max_num_faces=3,
                    refine_landmarks=True,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                )
            except Exception:
                if hasattr(mp, 'solutions') and hasattr(mp.solutions, 'face_mesh'):
                    self.mp_face_mesh = mp.solutions.face_mesh.FaceMesh(
                        max_num_faces=3,
                        refine_landmarks=True,
                        min_detection_confidence=0.5,
                        min_tracking_confidence=0.5
                    )
                else:
                    print("[AIMonitor Warning] MediaPipe face mesh solution unavailable.")

            # Setup OpenCV Haar Cascade Face, Profile, and Eye detectors (works natively on all Python versions)
            try:
                self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
                self.profile_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')
                self.eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
                
                if self.face_cascade.empty():
                    self.face_cascade = None
                if self.profile_cascade.empty():
                    self.profile_cascade = None
                if self.eye_cascade.empty():
                    self.eye_cascade = None
                    
                if self.face_cascade is not None:
                    print("[AIMonitor] OpenCV Frontal & Profile Face detectors loaded successfully.")
            except Exception as e:
                print(f"[AIMonitor Warning] Failed to load OpenCV Cascades: {e}")
                self.face_cascade = None
                self.profile_cascade = None
                self.eye_cascade = None

            # Load ONNX model for object detection (configured for minimal CPU footprint)
            model_path_std = os.path.join(base_dir, "yolo26n.onnx")
            model_path_int8 = os.path.join(base_dir, "yolo26n_int8.onnx")
            model_path = model_path_std if os.path.exists(model_path_std) else model_path_int8

            if os.path.exists(model_path):
                try:
                    sess_options = ort.SessionOptions()
                    sess_options.intra_op_num_threads = 2
                    sess_options.inter_op_num_threads = 1
                    sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
                    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                    self.ort_session = ort.InferenceSession(
                        model_path,
                        sess_options=sess_options,
                        providers=["CPUExecutionProvider"]
                    )
                    print(f"[AIMonitor] ONNX YOLO object detector loaded successfully ({os.path.basename(model_path)}) [CPU-Bounded: 2 Threads].")
                except Exception as e:
                    print(f"[AIMonitor Warning] Failed to load ONNX model: {e}")

            enable_camera = os.environ.get("ENABLE_CAMERA_MONITOR", "true").lower() == "true"
            self.is_active = enable_camera and (self.mp_face_mesh is not None or self.face_cascade is not None or self.ort_session is not None)
            if self.is_active:
                print("[AIMonitor] AI camera monitoring initialized successfully.")
            else:
                print("[AIMonitor] Camera monitor disabled.")
        except Exception as e:
            print(f"[AIMonitor Warning] Could not initialize AI monitor: {e}")
            self.is_active = False

        # 3D face model points for PnP solve used in yaw estimation
        self.face_3d = np.array([
            (0.0, 0.0, 0.0),            # Nose tip
            (0.0, -330.0, -65.0),       # Chin
            (-225.0, 170.0, -135.0),    # Left eye corner
            (225.0, 170.0, -135.0),     # Right eye corner
            (-150.0, -150.0, -125.0),   # Left mouth corner
            (150.0, -150.0, -125.0)     # Right mouth corner
        ], dtype=np.float64)

    def start(self, camera_index=0):
        """
        Starts the monitoring loop reading from the webcam in a non-blocking background thread.
        """
        if not getattr(self, "is_active", False):
            print("[AIMonitor] AI camera monitor inactive. Skipping camera loop.")
            return

        import threading
        if threading.current_thread() is threading.main_thread():
            thread = threading.Thread(target=self._run_loop, args=(camera_index,), daemon=True)
            thread.start()
        else:
            self._run_loop(camera_index)

    def _run_loop(self, camera_index=0):
        self.running = True
        cap = None
        
        # Retry camera initialization up to 10 attempts (5 seconds total)
        for attempt in range(1, 11):
            if not self.running:
                return
            
            print(f"[AIMonitor] Opening camera (attempt {attempt}/10)...")
            
            # Try standard backend first
            cap = cv2.VideoCapture(camera_index)
            if not cap.isOpened():
                cap.release()
                # On Windows, try CAP_DSHOW or CAP_MSMF
                if os.name == 'nt':
                    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
                    if not cap.isOpened():
                        cap.release()
                        cap = cv2.VideoCapture(camera_index, cv2.CAP_MSMF)
            
            if cap and cap.isOpened():
                # Verify we can actually read a valid frame
                ret, test_frame = cap.read()
                if ret and test_frame is not None:
                    print(f"[AIMonitor] Camera monitoring active on device index {camera_index}.")
                    break
                else:
                    cap.release()
                    cap = None
            
            time.sleep(0.5)

        if not cap or not cap.isOpened():
            print("[AIMonitor Warning] Could not open camera device after retries. AI camera monitoring disabled.")
            return

        consecutive_read_failures = 0
        target_frame_interval = 0.085  # ~11.7 FPS: Optimal real-time responsiveness with minimal CPU load
        try:
            while self.running:
                loop_start = time.time()
                ret, frame = cap.read()
                if not ret or frame is None:
                    consecutive_read_failures += 1
                    time.sleep(0.1)
                    
                    # If camera stream drops during exam, attempt to reconnect
                    if consecutive_read_failures > 50:
                        print("[AIMonitor Warning] Lost camera stream. Re-initializing camera capture...")
                        cap.release()
                        time.sleep(1.0)
                        cap = cv2.VideoCapture(camera_index)
                        consecutive_read_failures = 0
                    continue
                    
                consecutive_read_failures = 0
                self.frame_count += 1
                
                if self.mp_face_mesh:
                    try:
                        self._check_head_pose(frame)
                    except Exception:
                        pass
                elif self.face_cascade:
                    try:
                        self._check_faces_opencv(frame)
                    except Exception:
                        pass
                    
                # Run YOLO inference every 3rd frame (~3.8 inferences/sec)
                if self.frame_count % 3 == 0 and self.ort_session:
                    try:
                        self._check_objects(frame)
                    except Exception:
                        pass
                        
                # Dynamic sleep to ensure CPU sleeps between frames
                elapsed = time.time() - loop_start
                sleep_duration = max(0.005, target_frame_interval - elapsed)
                time.sleep(sleep_duration)
        except Exception as e:
            print(f"[AIMonitor Error] Camera monitoring loop crashed: {e}")
        finally:
            if 'cap' in locals() and cap and cap.isOpened():
                cap.release()

    def _check_faces_opencv(self, frame):
        """
        Robust multi-cascade face, eye, profile, and multi-directional head/gaze monitoring.
        Uses downscaled grayscale processing (scale factor) for low CPU usage (<5%) while preserving accuracy.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        frame_h, frame_w = frame.shape[:2]
        
        # 0. Check Camera Occlusion & Severe Underexposure/Covering (< 0.05ms)
        if hasattr(self, 'occlusion_detector') and self.occlusion_detector is not None:
            is_occluded, reason, metrics = self.occlusion_detector.analyze_frame(gray)
            if is_occluded:
                now = time.time()
                if now - getattr(self, 'last_occlusion_violation_at', 0) >= 3.0:
                    self.last_occlusion_violation_at = now
                    annotated = frame.copy()
                    cv2.putText(annotated, "CAMERA OCCLUDED / FEED DARK", (30, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 255), 2)
                    cv2.putText(annotated, f"Issue: {reason}", (30, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 165, 255), 2)
                    self._emit_violation(
                        "camera_occluded_or_dark",
                        severity=3,
                        details={"reason": reason, "mean_brightness": metrics.get("mean_brightness", 0), "variance": metrics.get("variance", 0)},
                        frame=annotated
                    )
                self.no_face_start = None
                return

        # Downscale for ultra-fast Haar Cascade evaluation (4x-6x faster than full res)
        scale_factor = 360.0 / frame_w if frame_w > 360 else 1.0
        if scale_factor < 1.0:
            proc_gray = cv2.resize(gray, (0, 0), fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_LINEAR)
        else:
            proc_gray = gray

        min_face_size = int(50 * scale_factor)

        # 1. Detect Frontal Faces on downscaled frame
        raw_faces = self.face_cascade.detectMultiScale(
            proc_gray, 
            scaleFactor=1.15, 
            minNeighbors=4, 
            minSize=(min_face_size, min_face_size)
        )
        
        # Rescale face bounding boxes to original frame coordinates
        inv_scale = 1.0 / scale_factor
        faces = [
            (int(fx * inv_scale), int(fy * inv_scale), int(fw * inv_scale), int(fh * inv_scale))
            for (fx, fy, fw, fh) in raw_faces if (fw * inv_scale) >= 50
        ]

        num_faces = len(faces)
        left_profiles = []
        right_profiles = []

        # 2. Check Profile Cascades ONLY when frontal face is NOT visible
        if num_faces == 0 and self.profile_cascade is not None:
            raw_left = self.profile_cascade.detectMultiScale(
                proc_gray, 
                scaleFactor=1.15, 
                minNeighbors=4, 
                minSize=(min_face_size, min_face_size)
            )
            flipped_proc_gray = cv2.flip(proc_gray, 1)
            raw_right = self.profile_cascade.detectMultiScale(
                flipped_proc_gray, 
                scaleFactor=1.15, 
                minNeighbors=4, 
                minSize=(min_face_size, min_face_size)
            )
            left_profiles = [(int(x * inv_scale), int(y * inv_scale), int(w * inv_scale), int(h * inv_scale)) for (x, y, w, h) in raw_left]
            right_profiles = [(int(x * inv_scale), int(y * inv_scale), int(w * inv_scale), int(h * inv_scale)) for (x, y, w, h) in raw_right]

        num_profiles = len(left_profiles) + len(right_profiles)

        # 3. Missing Face Check (No face or profile visible for >= 3.0s)
        if num_faces == 0 and num_profiles == 0:
            if self.no_face_start is None:
                self.no_face_start = time.time()
            elif time.time() - self.no_face_start >= 3.0:
                self._emit_violation("no_face_detected", severity=3, details={"reason": "Candidate not visible in camera view"}, frame=frame)
                self.no_face_start = None
            self.lateral_turn_start = None
            self.downward_gaze_start = None
            self.second_person_counter = 0
            return
            
        self.no_face_start = None

        # 4. Second Person Check (Strictly require >=2 distinct frontal faces for 5 consecutive frames)
        if num_faces >= 2:
            # Verify faces have distinct center points
            (x1, y1, w1, h1) = faces[0]
            (x2, y2, w2, h2) = faces[1]
            c1 = (x1 + w1 / 2, y1 + h1 / 2)
            c2 = (x2 + w2 / 2, y2 + h2 / 2)
            dist = np.hypot(c1[0] - c2[0], c1[1] - c2[1])
            
            if dist > 70:
                self.second_person_counter += 1
                if self.second_person_counter >= 5:
                    annotated = frame.copy()
                    for (fx, fy, fw, fh) in faces:
                        cv2.rectangle(annotated, (fx, fy), (fx + fw, fy + fh), (0, 165, 255), 2)
                        cv2.putText(annotated, "PERSON", (fx, max(20, fy - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
                    self._emit_violation("second_person_detected", severity=4, details={"face_count": num_faces, "reason": "Multiple people detected in view"}, frame=annotated)
                    self.second_person_counter = 0
            else:
                self.second_person_counter = 0
        else:
            self.second_person_counter = 0

        # 5. Multi-Directional Head Turn & Gaze Monitoring
        is_lateral_turn = False
        is_downward_gaze = False
        turn_reason = ""
        turn_direction = ""

        if num_faces == 0 and num_profiles > 0:
            # Candidate turned their head fully sideways away from the screen
            is_lateral_turn = True
            if len(left_profiles) > 0:
                turn_reason = "Head Turned Left (Profile View)"
                turn_direction = "left"
            else:
                turn_reason = "Head Turned Right (Profile View)"
                turn_direction = "right"

        elif num_faces == 1:
            (x, y, w, h) = faces[0]
            face_center_y = y + h / 2
            face_center_x = x + w / 2
            
            # Check for downward head pitch (looking down at desk / notes / lap)
            if (face_center_y / frame_h) > 0.72 or (y + h) / frame_h > 0.90:
                is_downward_gaze = True
                turn_reason = "Looking Down (Desk/Lap Gaze)"
                turn_direction = "down"
            elif self.eye_cascade is not None:
                # Eye ROI: upper half of face
                roi_gray = gray[y + int(h * 0.15):y + int(h * 0.55), x + int(w * 0.08):x + int(w * 0.92)]
                eyes = self.eye_cascade.detectMultiScale(roi_gray, scaleFactor=1.1, minNeighbors=3, minSize=(14, 14))
                
                # If face is somewhat lowered and eyes are obscured (head tilted downward)
                if len(eyes) == 0 and (face_center_y / frame_h) > 0.65:
                    is_downward_gaze = True
                    turn_reason = "Looking Down (Eyes Lowered)"
                    turn_direction = "down"
                elif len(eyes) >= 2:
                    sorted_eyes = sorted(eyes, key=lambda e: e[0])
                    eye1_center = sorted_eyes[0][0] + sorted_eyes[0][2] / 2
                    eye2_center = sorted_eyes[-1][0] + sorted_eyes[-1][2] / 2
                    eye_mid = (eye1_center + eye2_center) / 2
                    roi_w = w * 0.84
                    offset_ratio = (eye_mid - (roi_w / 2)) / (roi_w / 2)
                    
                    if offset_ratio < -0.22:
                        is_lateral_turn = True
                        turn_reason = "Looking Left (Side Gaze)"
                        turn_direction = "left"
                    elif offset_ratio > 0.22:
                        is_lateral_turn = True
                        turn_reason = "Looking Right (Side Gaze)"
                        turn_direction = "right"
                elif len(eyes) == 1:
                    ex, ey, ew, eh = eyes[0]
                    roi_w = w * 0.84
                    rel_pos = (ex + ew / 2) / roi_w
                    if rel_pos < 0.35:
                        is_lateral_turn = True
                        turn_reason = "Looking Left (Side Gaze)"
                        turn_direction = "left"
                    elif rel_pos > 0.65:
                        is_lateral_turn = True
                        turn_reason = "Looking Right (Side Gaze)"
                        turn_direction = "right"

        # Check Lateral Head Turn (Threshold: sustained_lateral_seconds)
        if is_lateral_turn:
            if self.lateral_turn_start is None:
                self.lateral_turn_start = time.time()
            else:
                elapsed = time.time() - self.lateral_turn_start
                lateral_limit = self.thresholds.get("sustained_lateral_seconds", 1.5)
                if elapsed >= lateral_limit:
                    annotated = frame.copy()
                    cv2.putText(annotated, f"SUSPICIOUS ACTIVITY: {turn_reason.upper()}", (30, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                    self._emit_violation(
                        "head_turn_away", 
                        severity=2, 
                        details={"duration": round(elapsed, 1), "reason": turn_reason, "direction": turn_direction},
                        frame=annotated
                    )
                    self.lateral_turn_start = None
        else:
            self.lateral_turn_start = None

        # Check Downward Gaze / Desk Glance (Threshold: sustained_downward_seconds)
        if is_downward_gaze:
            if self.downward_gaze_start is None:
                self.downward_gaze_start = time.time()
            else:
                elapsed = time.time() - self.downward_gaze_start
                downward_limit = self.thresholds.get("sustained_downward_seconds", 3.0)
                if elapsed >= downward_limit:
                    annotated = frame.copy()
                    cv2.putText(annotated, f"SUSPICIOUS ACTIVITY: {turn_reason.upper()}", (30, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                    self._emit_violation(
                        "head_turn_away", 
                        severity=2, 
                        details={"duration": round(elapsed, 1), "reason": turn_reason, "direction": turn_direction},
                        frame=annotated
                    )
                    self.downward_gaze_start = None
        else:
            self.downward_gaze_start = None

    def stop(self):
        """Stops the monitoring loop cleanly by breaking the while loop condition."""
        self.running = False

    def _check_head_pose(self, frame):
        """
        Estimates head yaw using MediaPipe Face Mesh and PnP solve.
        
        Emits 'no_face_detected' if no face is seen for 10 seconds.
        Emits 'camera_occluded_or_dark' immediately if lens is covered or dark.
        Emits 'head_turn_away' if absolute yaw exceeds the configured threshold
        for sustained seconds.
        """
        # Check Camera Occlusion & Severe Underexposure
        if hasattr(self, 'occlusion_detector') and self.occlusion_detector is not None:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            is_occluded, reason, metrics = self.occlusion_detector.analyze_frame(gray)
            if is_occluded:
                now = time.time()
                if now - getattr(self, 'last_occlusion_violation_at', 0) >= 3.0:
                    self.last_occlusion_violation_at = now
                    annotated = frame.copy()
                    cv2.putText(annotated, "CAMERA OCCLUDED / FEED DARK", (30, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 255), 2)
                    cv2.putText(annotated, f"Issue: {reason}", (30, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 165, 255), 2)
                    self._emit_violation(
                        "camera_occluded_or_dark",
                        severity=3,
                        details={"reason": reason, "mean_brightness": metrics.get("mean_brightness", 0), "variance": metrics.get("variance", 0)},
                        frame=annotated
                    )
                self.no_face_start = None
                return

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.mp_face_mesh.process(rgb_frame)
        
        if not results.multi_face_landmarks:
            if self.no_face_start is None:
                self.no_face_start = time.time()
            elif time.time() - self.no_face_start >= 3.0:
                self._emit_violation("no_face_detected", severity=3, details={"reason": "Candidate not visible in camera view"}, frame=frame)
                # Reset to None so it requires another 3 seconds to fire again
                self.no_face_start = None
            return
            
        # Face is detected, reset the no face timer
        self.no_face_start = None
        
        face_landmarks = results.multi_face_landmarks[0]
        h, w, c = frame.shape
        
        # Extract the 6 key landmarks for the 2D image points
        face_2d = np.array([
            (face_landmarks.landmark[1].x * w, face_landmarks.landmark[1].y * h),
            (face_landmarks.landmark[152].x * w, face_landmarks.landmark[152].y * h),
            (face_landmarks.landmark[263].x * w, face_landmarks.landmark[263].y * h),
            (face_landmarks.landmark[33].x * w, face_landmarks.landmark[33].y * h),
            (face_landmarks.landmark[287].x * w, face_landmarks.landmark[287].y * h),
            (face_landmarks.landmark[57].x * w, face_landmarks.landmark[57].y * h)
        ], dtype=np.float64)
        
        # Approximate focal length and camera matrix
        focal_length = 1 * w
        cam_matrix = np.array([[focal_length, 0, w / 2],
                               [0, focal_length, h / 2],
                               [0, 0, 1]], dtype=np.float64)
        dist_matrix = np.zeros((4, 1), dtype=np.float64)
        
        # Solve PnP to find rotation vector
        success, rot_vec, trans_vec = cv2.solvePnP(self.face_3d, face_2d, cam_matrix, dist_matrix)
        if not success:
            return
            
        rmat, jac = cv2.Rodrigues(rot_vec)
        angles, mtxR, mtxQ, Qx, Qy, Qz = cv2.RQDecomp3x3(rmat)
        
        # angles[1] corresponds to the yaw angle in degrees
        yaw = angles[1]
        
        if abs(yaw) > self.thresholds["yaw_threshold_degrees"]:
            if self.head_turn_start is None:
                self.head_turn_start = time.time()
            else:
                elapsed = time.time() - self.head_turn_start
                if elapsed >= self.thresholds["sustained_seconds"]:
                    self._emit_violation(
                        "head_turn_away", 
                        severity=2, 
                        details={"duration": elapsed},
                        frame=frame
                    )
                    # Reset so it doesn't fire every frame while the head stays turned
                    self.head_turn_start = None
        else:
            self.head_turn_start = None

    def _check_face_count(self, frame):
        """
        Counts faces in the frame. Requires 3 consecutive over-threshold checks 
        to emit 'second_person_detected'.
        """
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.mp_face_mesh.process(rgb_frame)
        
        count = 0
        if results.multi_face_landmarks:
            count = len(results.multi_face_landmarks)
            
        if count > 1:
            self.second_person_counter += 1
            if self.second_person_counter >= 3:
                self._emit_violation("second_person_detected", severity=4, details={}, frame=frame)
                self.second_person_counter = 0
        else:
            self.second_person_counter = 0

    def _check_objects(self, frame):
        """
        Runs YOLO object detection model to find unauthorized items.
        Filters for 'cell phone' (class 67) and 'book' (class 73).
        """
        now = time.time()
        if hasattr(self, 'last_object_violation_at') and (now - self.last_object_violation_at < 2.0):
            return

        h, w = frame.shape[:2]

        # Preprocess: Ultra-fast SIMD C++ batch blob extraction (zero Python memory copy)
        batch_input = cv2.dnn.blobFromImage(
            frame, 
            scalefactor=1.0 / 255.0, 
            size=(640, 640), 
            mean=(0, 0, 0), 
            swapRB=True, 
            crop=False
        )
        
        # Run ONNX inference
        input_name = self.ort_session.get_inputs()[0].name
        outputs = self.ort_session.run(None, {input_name: batch_input})
        output_tensor = outputs[0]

        if len(output_tensor.shape) == 3:
            output_tensor = output_tensor[0]

        conf_thresh = self.thresholds.get("object_detection_confidence", 0.25)
        target_classes = {67: "cell phone", 73: "book"}

        # Format A: Shape (300, 6) -> [x1, y1, x2, y2, conf, class_id]
        if output_tensor.shape[-1] == 6 or (len(output_tensor.shape) == 2 and output_tensor.shape[1] == 6):
            for pred in output_tensor:
                confidence = float(pred[4])
                if confidence < conf_thresh:
                    continue
                    
                class_id = int(pred[5])
                if class_id in target_classes:
                    class_name = target_classes[class_id]
                    self.last_object_violation_at = now
                    
                    # Annotate frame with red detection box
                    annotated = frame.copy()
                    x1 = int(pred[0] * w / 640)
                    y1 = int(pred[1] * h / 640)
                    x2 = int(pred[2] * w / 640)
                    y2 = int(pred[3] * h / 640)
                    cv2.rectangle(annotated, (max(0, x1), max(0, y1)), (min(w, x2), min(h, y2)), (0, 0, 255), 2)
                    label = f"{class_name.upper()}: {int(confidence * 100)}%"
                    cv2.putText(annotated, label, (max(0, x1), max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

                    self._emit_violation(
                        "unauthorized_object",
                        severity=3,
                        details={"confidence": round(confidence, 2), "object_class": class_name},
                        frame=annotated
                    )
                    break
        # Format B: Shape (84, 8400) -> Standard YOLO ONNX output
        elif len(output_tensor.shape) == 2 and output_tensor.shape[0] == 84:
            boxes_scores = output_tensor.T # (8400, 84)
            best_match = None
            best_conf = 0.0

            for pred in boxes_scores:
                class_scores = pred[4:]
                
                # Check cell phone (67)
                if len(class_scores) > 67:
                    p_conf = float(class_scores[67])
                    if p_conf >= conf_thresh and p_conf > best_conf:
                        best_conf = p_conf
                        best_match = (pred, 67, "cell phone", p_conf)
                
                # Check book (73)
                if len(class_scores) > 73:
                    b_conf = float(class_scores[73])
                    if b_conf >= conf_thresh and b_conf > best_conf:
                        best_conf = b_conf
                        best_match = (pred, 73, "book", b_conf)

            if best_match is not None:
                pred, class_id, class_name, confidence = best_match
                self.last_object_violation_at = now

                # Annotate frame with red detection box
                annotated = frame.copy()
                cx, cy, bw, bh = pred[0], pred[1], pred[2], pred[3]
                x1 = int((cx - bw / 2) * w / 640)
                y1 = int((cy - bh / 2) * h / 640)
                x2 = int((cx + bw / 2) * w / 640)
                y2 = int((cy + bh / 2) * h / 640)
                cv2.rectangle(annotated, (max(0, x1), max(0, y1)), (min(w, x2), min(h, y2)), (0, 0, 255), 2)
                label = f"{class_name.upper()}: {int(confidence * 100)}%"
                cv2.putText(annotated, label, (max(0, x1), max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

                self._emit_violation(
                    "unauthorized_object",
                    severity=3,
                    details={"confidence": round(confidence, 2), "object_class": class_name},
                    frame=annotated
                )

    def _emit_violation(self, violation_type, severity, details, frame=None):
        """
        Constructs the violation event matching the standard schema and emits it with webcam evidence.
        """
        screenshot_path = None
        try:
            if frame is not None:
                from services.capture import capture_webcam_frame
                screenshot_path = capture_webcam_frame(self.session_id, violation_type, frame=frame)
            else:
                from services.capture import capture_screenshot
                screenshot_path = capture_screenshot(self.session_id, violation_type)
        except Exception as e:
            print(f"[AIMonitor Warning] Could not capture evidence for {violation_type}: {e}")

        event = {
            "sessionId": self.session_id,
            "type": violation_type,
            "severity": severity,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "details": details,
            "screenshotPath": screenshot_path
        }
        
        if self.on_violation:
            self.on_violation(event)
        else:
            print(json.dumps(event, indent=2))

if __name__ == "__main__":
    monitor = AIMonitor(session_id="test-session", on_violation=print)
    try:
        print("Starting AI Monitor... Press Ctrl+C to stop.")
        monitor.start()
    except KeyboardInterrupt:
        print("\nStopping AI Monitor...")
        monitor.stop()