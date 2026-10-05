<!--
IntegrityFlow file overview
Purpose: Documentation for locally stored face models.
How it works: Explains model assets and their role in the face-processing subsystem.
Connection: The nearby ONNX and Tasks files are binary trained models and cannot contain source comments.
-->
# Offline face models

The exam uses `face_landmarker.task` with MediaPipe 0.10.35 Tasks VIDEO mode. OpenCV Haar remains a fallback if the package or model cannot initialize; repeated runtime inference failures also select the fallback. No runtime model download is required.

- Google Face Landmarker float16 bundle, version 1:
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
  SHA256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
  Documentation/model cards: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- OpenCV YuNet 2023mar model, for evaluation only (not enabled during exams):
  https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
  SHA256: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`
  OpenCV Zoo distributes this directory under MIT: https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE

Keep these model files with `ai-module` when copying the project. YuNet's 2023 model targets the installed OpenCV 4.x runtime; do not substitute the 2026 OpenCV 5 model blindly.

## Evaluate before changing the face counter

Run from `ai-module`:

```powershell
python evaluate_faces.py --image single.jpg --expected 1 --image two.jpg --expected 2 --image empty.jpg --expected 0
python check_detection.py
```

The evaluator reports predicted counts and single-image inference times. It is not a full false-positive, video latency or gaze benchmark. Supply representative, consented images with glasses, different lighting, moderate turns and two people. The evaluator reads images locally and does not emit violations or save evidence.

On the user's previously supplied head-turn image, frontal Haar found zero faces while YuNet and MediaPipe each found one. All three found zero faces on a uniform blank image. These two examples justify testing the modern path, not claiming a measured accuracy improvement. The exam uses MediaPipe's own multiple-face output, not the union of two detectors.
