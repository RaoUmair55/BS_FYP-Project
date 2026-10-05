# IntegrityFlow file overview
# Purpose: Offline comparison of face counters on labelled images.
# How it works: Runs OpenCV Haar, YuNet and MediaPipe Tasks on supplied
#  images, compares counts with expected labels, and prints counts and
#  inference time.
# Connection: Use collected test images to evaluate behavior; this script
#  never starts the camera or emits exam alerts.
"""Compare local face counters on labelled images; never starts camera or emits events.
Example: python evaluate_faces.py --image single.jpg --expected 1 --image two.jpg --expected 2
"""
import argparse
import json
from pathlib import Path
import time
import cv2
import mediapipe as mp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', action='append', required=True)
    parser.add_argument('--expected', action='append', type=int, required=True)
    args = parser.parse_args()
    if len(args.image) != len(args.expected) or any(n < 0 for n in args.expected):
        parser.error('Supply one nonnegative expected face count per image.')
    models = Path(__file__).resolve().parent / 'models'
    haar = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    yunet = cv2.FaceDetectorYN.create(str(models / 'face_detection_yunet_2023mar.onnx'), '', (640, 480), .8, .3)
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(models / 'face_landmarker.task')),
        running_mode=mp.tasks.vision.RunningMode.IMAGE, num_faces=3,
        min_face_detection_confidence=.6, min_face_presence_confidence=.6,
        min_tracking_confidence=.6)
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
        for path, expected in zip(args.image, args.expected):
            frame = cv2.imread(path)
            if frame is None:
                parser.error(f'Cannot read image: {path}')
            height, width = frame.shape[:2]
            yunet.setInputSize((width, height))
            detectors = {
                'haar': lambda: len(haar.detectMultiScale(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY),
                                      scaleFactor=1.15, minNeighbors=4, minSize=(50, 50))),
                'yunet': lambda: 0 if (rows := yunet.detect(frame)[1]) is None else len(rows),
                'mediapipe_tasks': lambda: len(landmarker.detect(mp.Image(
                    image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))).face_landmarks),
            }
            results = {}
            for name, detect in detectors.items():
                started = time.perf_counter()
                count = detect()
                results[name] = {'count': count, 'matches_expected': count == expected,
                                 'inference_ms': round((time.perf_counter() - started) * 1000, 1)}
            print(json.dumps({'image': Path(path).name, 'expected': expected, 'results': results}))


if __name__ == '__main__':
    main()
