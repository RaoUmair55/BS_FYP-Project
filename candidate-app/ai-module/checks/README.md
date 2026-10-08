# AI developer checks

Run from `candidate-app/ai-module/` with the project Python environment:

```sh
python checks/check_detection.py
python checks/check_camera_photos.py
```

These regressions use synthetic inputs and controlled dependencies, without real camera capture, microphone recording, USB ejection or process termination. The scripts add the AI module directory to the import path so direct execution still works.
