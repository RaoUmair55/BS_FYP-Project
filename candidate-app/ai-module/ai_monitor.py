import cv2
import time
import json
import numpy as np
import mediapipe as mp
import onnxruntime as ort
import os
from datetime import datetime, timezone
from typing import Callable, Optional

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
        self.no_face_start = None
        self.second_person_counter = 0
        self.mp_face_mesh = None
        self.ort_session = None

        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        try:
            # Load configuration
            config_path = os.path.join(base_dir, "config", "thresholds.json")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    self.thresholds = json.load(f)
            else:
                self.thresholds = {
                    "yaw_threshold_degrees": 25,
                    "sustained_seconds": 3,
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

            # Setup OpenCV Haar Cascade Face detector (works natively on Python 3.14)
            try:
                cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
                self.face_cascade = cv2.CascadeClassifier(cascade_path)
                if self.face_cascade.empty():
                    self.face_cascade = None
                else:
                    print("[AIMonitor] OpenCV Haar Cascade face detector loaded successfully.")
            except Exception as e:
                print(f"[AIMonitor Warning] Failed to load OpenCV Haar Cascade: {e}")
                self.face_cascade = None

            # Load ONNX model for object detection if present
            model_path = os.path.join(base_dir, "yolo26n.onnx")
            if os.path.exists(model_path):
                try:
                    self.ort_session = ort.InferenceSession(
                        model_path,
                        providers=["CPUExecutionProvider"]
                    )
                    print("[AIMonitor] ONNX YOLO object detector loaded successfully.")
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
        try:
            while self.running:
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
                        if self.frame_count % 10 == 0:
                            self._check_face_count(frame)
                    except Exception:
                        pass
                elif self.face_cascade:
                    try:
                        self._check_faces_opencv(frame)
                    except Exception:
                        pass
                    
                if self.frame_count % 15 == 0 and self.ort_session:
                    try:
                        self._check_objects(frame)
                    except Exception:
                        pass
                        
                time.sleep(0.03)
        except Exception as e:
            print(f"[AIMonitor Error] Camera monitoring loop crashed: {e}")
        finally:
            if 'cap' in locals() and cap and cap.isOpened():
                cap.release()

    def _check_faces_opencv(self, frame):
        """Fallback face detection using OpenCV Haar Cascades."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(
            gray, 
            scaleFactor=1.1, 
            minNeighbors=5, 
            minSize=(60, 60)
        )
        
        num_faces = len(faces)
        
        # 1. Missing Face Check
        if num_faces == 0:
            if self.no_face_start is None:
                self.no_face_start = time.time()
            elif time.time() - self.no_face_start >= 10.0:
                self._emit_violation("no_face_detected", severity=3, details={})
                self.no_face_start = None
            return
            
        self.no_face_start = None

        # 2. Second Person Check
        if num_faces > 1:
            self.second_person_counter += 1
            if self.second_person_counter >= 3:
                self._emit_violation("second_person_detected", severity=4, details={"face_count": num_faces})
                self.second_person_counter = 0
        else:
            self.second_person_counter = 0

        # 3. Head Turn / Off-Center Check
        (x, y, w, h) = faces[0]
        face_center_x = x + w / 2
        frame_center_x = frame.shape[1] / 2
        offset_ratio = abs(face_center_x - frame_center_x) / frame_center_x

        if offset_ratio > 0.45:
            if self.head_turn_start is None:
                self.head_turn_start = time.time()
            else:
                elapsed = time.time() - self.head_turn_start
                if elapsed >= self.thresholds.get("sustained_seconds", 3):
                    self._emit_violation(
                        "head_turn_away", 
                        severity=2, 
                        details={"duration": elapsed, "offset_ratio": round(offset_ratio, 2)}
                    )
                    self.head_turn_start = None
        else:
            self.head_turn_start = None

    def stop(self):
        """Stops the monitoring loop cleanly by breaking the while loop condition."""
        self.running = False

    def _check_head_pose(self, frame):
        """
        Estimates head yaw using MediaPipe Face Mesh and PnP solve.
        
        Emits 'no_face_detected' if no face is seen for 10 seconds.
        Emits 'head_turn_away' if absolute yaw exceeds the configured threshold
        for sustained seconds.
        """
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.mp_face_mesh.process(rgb_frame)
        
        if not results.multi_face_landmarks:
            if self.no_face_start is None:
                self.no_face_start = time.time()
            elif time.time() - self.no_face_start >= 10.0:
                self._emit_violation("no_face_detected", severity=3, details={})
                # Reset to None so it requires another 10 seconds to fire again
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
                        details={"duration": elapsed}
                    )
                    # Reset so it doesn't fire every frame while the head stays turned
                    self.head_turn_start = None
        else:
            self.head_turn_start = None

    def _check_face_count(self, frame):
        """
        Counts faces in the frame. Requires 3 consecutive over-threshold checks 
        to emit 'second_person_detected'.
        
        Reasoning: MediaPipe can occasionally hallucinate a face for a single frame.
        Requiring 3-in-a-row (which is 30 actual frames, ~1 second) avoids these
        false positives.
        """
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.mp_face_mesh.process(rgb_frame)
        
        count = 0
        if results.multi_face_landmarks:
            count = len(results.multi_face_landmarks)
            
        if count > 1:
            self.second_person_counter += 1
            if self.second_person_counter >= 3:
                self._emit_violation("second_person_detected", severity=4, details={})
                self.second_person_counter = 0
        else:
            self.second_person_counter = 0

    def _check_objects(self, frame):
        """
        Runs YOLO object detection model to find unauthorized items.
        Filters for 'cell phone' (class 67) and 'book' (class 73).
        """
        now = time.time()
        if hasattr(self, 'last_object_violation_at') and (now - self.last_object_violation_at < 3.0):
            return

        # Preprocess: resize -> RGB -> CHW -> normalize -> batch dim -> float32
        resized = cv2.resize(frame, (640, 640))
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        chw = np.transpose(rgb, (2, 0, 1))
        normalized = chw.astype(np.float32) / 255.0
        batch_input = np.expand_dims(normalized, axis=0)
        
        # Run ONNX inference
        input_name = self.ort_session.get_inputs()[0].name
        outputs = self.ort_session.run(None, {input_name: batch_input})
        output_tensor = outputs[0]

        if len(output_tensor.shape) == 3:
            output_tensor = output_tensor[0]

        conf_thresh = self.thresholds.get("object_detection_confidence", 0.35)

        # Format A: Shape (300, 6) -> [x1, y1, x2, y2, conf, class_id]
        if output_tensor.shape[-1] == 6 or (len(output_tensor.shape) == 2 and output_tensor.shape[1] == 6):
            for pred in output_tensor:
                confidence = float(pred[4])
                if confidence < conf_thresh:
                    continue
                    
                class_id = int(pred[5])
                if class_id == 67 or class_id == 73: # Cell phone or book
                    class_name = COCO_CLASSES[class_id] if 0 <= class_id < len(COCO_CLASSES) else "cell phone"
                    self.last_object_violation_at = now
                    self._emit_violation(
                        "unauthorized_object",
                        severity=3,
                        details={"confidence": round(confidence, 2), "object_class": class_name}
                    )
                    break
        # Format B: Shape (84, 8400) -> Standard YOLO ONNX output
        elif len(output_tensor.shape) == 2 and output_tensor.shape[0] == 84:
            boxes_scores = output_tensor.T # (8400, 84)
            for pred in boxes_scores:
                class_scores = pred[4:]
                class_id = int(np.argmax(class_scores))
                confidence = float(class_scores[class_id])
                
                if confidence >= conf_thresh:
                    if class_id == 67 or class_id == 73: # Cell phone or book
                        class_name = COCO_CLASSES[class_id] if 0 <= class_id < len(COCO_CLASSES) else "cell phone"
                        self.last_object_violation_at = now
                        self._emit_violation(
                            "unauthorized_object",
                            severity=3,
                            details={"confidence": round(confidence, 2), "object_class": class_name}
                        )
                        break

    def _emit_violation(self, violation_type, severity, details):
        """
        Constructs the violation event matching the standard schema and emits it with screenshot evidence.
        """
        screenshot_path = None
        try:
            import screenshot_capture
            screenshot_path = screenshot_capture.capture_screenshot(self.session_id, violation_type)
        except Exception as e:
            print(f"[AIMonitor Warning] Could not capture screenshot for {violation_type}: {e}")

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