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

    def __init__(self, session_id: str, on_violation: Optional[Callable] = None):
        """
        Initializes the AIMonitor with session details, configuration, and ML models.
        
        Args:
            session_id: The ID of the current exam session.
            on_violation: Callback function invoked when a violation is detected.
                          Called with a completed violation dict.
        """
        self.session_id = session_id
        self.on_violation = on_violation
        
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Load configuration (yaw_threshold_degrees, sustained_seconds, object_detection_confidence)
        config_path = os.path.join(base_dir, "config", "thresholds.json")
        with open(config_path, "r") as f:
            self.thresholds = json.load(f)
            
        # Setup MediaPipe Face Mesh
        # max_num_faces=3 allows us to detect multiple people without wasting too much compute.
        self.mp_face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=3,#self._check_head_pose(frame)
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        # Load ONNX model for object detection
        # Note: Using FP32 YOLO26 model on CPU for now. INT8 calibration comes later
        # once we have a proper calibration set.
        model_path = os.path.join(base_dir, "yolo26n.onnx")
        self.ort_session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"]
        )
        
        # State variables
        self.frame_count = 0
        self.head_turn_start = None
        self.no_face_start = None
        self.second_person_counter = 0
        self.running = False
        
        # 3D face model points for PnP solve used in yaw estimation
        # We use a standard 3D face model mapped to MediaPipe landmarks:
        # Nose tip (1), Chin (152), Left eye corner (263), Right eye corner (33),
        # Left mouth corner (287), Right mouth corner (57)
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
        Starts the monitoring loop reading from the webcam.
        
        Args:
            camera_index: The index of the webcam to use. Defaults to 0.
        """
        self.running = True
        cap = cv2.VideoCapture(camera_index)
        
        while self.running:
            ret, frame = cap.read()
            if not ret:
                continue
                
            self.frame_count += 1
            
            # Check head pose every frame for immediate and accurate continuous tracking
            self._check_head_pose(frame)
            cv2.imshow("DEBUG - AI Monitor", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                self.running = False

            # Check face count every 10 frames (saving compute, as additional people
            # entering the frame don't need per-frame tracking to be caught)
            if self.frame_count % 10 == 0:
                self._check_face_count(frame)
                
            # Check for objects every 90 frames (approx. every 3 seconds at 30fps)
            # Object detection is heavy, and phones/books don't disappear in 3 seconds.
            if self.frame_count % 90 == 0:
                self._check_objects(frame)
                
        cap.release()
        cv2.destroyAllWindows()

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
        Runs YOLO26 object detection model to find unauthorized items.
        Filters for 'cell phone' (class 67) and 'book' (class 73).
        
        Reasoning for no NMS: The model output is already post-NMS natively from
        its ONNX export graph, resulting in exactly (1, 300, 6) shape. We just need 
        to threshold by confidence, which removes the need for extra processing.
        """
        # Preprocess: resize -> RGB -> CHW -> normalize -> batch dim -> float32
        resized = cv2.resize(frame, (640, 640))
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        chw = np.transpose(rgb, (2, 0, 1))
        normalized = chw.astype(np.float32) / 255.0
        batch_input = np.expand_dims(normalized, axis=0)
        
        # Run ONNX inference
        input_name = self.ort_session.get_inputs()[0].name
        outputs = self.ort_session.run(None, {input_name: batch_input})
        
        # Output shape is (1, 300, 6) -> 300 rows of [x1, y1, x2, y2, conf, class_id]
        predictions = outputs[0][0]
        
        # Note: box coordinates [x1, y1, x2, y2] are in 640x640 space and would need 
        # scaling back to the original frame's width/height only if drawing debug 
        # boxes later — not needed for violation emission itself.
        for pred in predictions:
            confidence = float(pred[4])
            if confidence < self.thresholds["object_detection_confidence"]:
                continue
                
            class_id = int(pred[5])
            if class_id < 0 or class_id >= len(COCO_CLASSES):
                continue
                
            class_name = COCO_CLASSES[class_id]
            
            # Only act on cell phone (67) and book (73)
            if class_id == 67 or class_id == 73:
                self._emit_violation(
                    "unauthorized_object",
                    severity=3,
                    details={"confidence": confidence, "object_class": class_name}
                )

    def _emit_violation(self, violation_type, severity, details):
        """
        Constructs the violation event matching the standard schema and emits it.
        Calls the on_violation callback if set, otherwise prints to stdout.
        """
        event = {
            "sessionId": self.session_id,
            "type": violation_type,
            "severity": severity,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "details": details,
            "screenshotPath": None  # Always null here, filled in later by screenshot_capture.py
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