# Self-hosted side-camera assets

- MediaPipe Tasks Vision **0.10.21** (`vision_bundle.mjs` and the SIMD/non-SIMD WASM files): Google, Apache-2.0. Installed from the pinned `@mediapipe/tasks-vision` package; copied from `server/node_modules/@mediapipe/tasks-vision/`.
- EfficientDet-Lite0 float32, model version **1**: Google MediaPipe model, Apache-2.0. Source: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite
- License: https://www.apache.org/licenses/LICENSE-2.0
- Integration reference: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js

`assets-manifest.json` records SHA-256 digests of the vendored assets. All runtime URLs are same-origin. No CDN request is needed on the phone. Keep the third-party license notices when distributing these assets. Socket.io's browser client is served by the installed Socket.io backend at `/socket.io/socket.io.js`.

To refresh deliberately, install the selected pinned Tasks Vision version, copy its `vision_bundle.mjs` and complete `wasm/` directory into `vendor/`, fetch the compatible model from Google's published model URL, update the version notes/digests, and rerun both browser and real-phone checks. Do not replace models silently during a presentation.
