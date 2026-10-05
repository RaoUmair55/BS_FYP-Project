# IntegrityFlow file overview
# Purpose: Local FastAPI endpoints used by Electron.
# How it works: Reports subsystem health and exposes application/USB checks,
# whitelist configuration, process termination, face calibration and
# voice-reference checks.
# Connection: main.py attaches the monitor instances;
# this API is separate from the project central server.
from fastapi import FastAPI
import os
import json
import time

app = FastAPI()

@app.get("/health")
def health_check():
    errors = list(globals().get('startup_errors', []))
    if globals().get('alert_delivery_error'):
        errors.append(alert_delivery_error)
    lab = os.environ.get('EXAM_TYPE') == 'physical_lab'
    self_check = os.environ.get('IS_SELF_CHECK', 'false').lower() in ('true', '1')
    if not lab:
        voice = globals().get('voice_monitor')
        if voice is None or voice.vad is None or voice.encoder is None:
            errors.append('Voice model not ready. Check the Python dependencies and voice model installation.')
        if voice is not None and getattr(voice, "verification_error", None):
            errors.append(voice.verification_error)
        if voice is not None and getattr(voice, 'capture_error', None):
            errors.append(voice.capture_error)
        if not self_check:
            camera = globals().get('ai_monitor')
            if camera is None or not getattr(camera, 'camera_ready', False) or time.monotonic() - getattr(camera, 'last_frame_at', 0) > 5:
                errors.append('Camera monitoring is unavailable. Close other camera apps and retry the system check.')
            rules = json.loads(os.environ.get('EXAM_RULES', '{}'))
            if camera is not None:
                errors.extend(camera.detector_errors.values())
                if getattr(camera, 'face_landmarker', None) is None and camera.mp_face_mesh is None and camera.face_cascade is None:
                    errors.append('Face detector unavailable. Check the OpenCV installation.')
            if rules.get('detectCellPhone') is not False and (camera is None or camera.ort_session is None):
                errors.append('Object detection model unavailable. Check ai-module/yolo26n.onnx or yolo26n_int8.onnx.')
            if voice is not None and (not voice.running or voice.stream is None or voice.reference_embedding is None):
                errors.append('Voice monitoring unavailable or reference voice missing. Re-record the voice sample.')
            elif voice is not None and time.monotonic() - getattr(voice, 'last_audio_at', 0) > 5:
                errors.append('Microphone stopped delivering audio. Notify your examiner.')
    usb = globals().get('usb_monitor')
    if usb is not None and usb.last_error:
        errors.append(usb.last_error)
    return {'status': 'ok' if not errors else 'degraded', 'instanceId': os.environ.get('AI_INSTANCE_ID'), 'errors': errors}

@app.post("/violation")
def log_violation(payload: dict):
    print("Violation logged:", payload)
    return payload

@app.post("/configure-whitelist")
def configure_whitelist(payload: dict):
    import server
    allowed_apps = payload.get("allowed_apps", [])
    if hasattr(server, 'enforcer') and server.enforcer:
        server.enforcer.set_allowed_apps(allowed_apps)
        return {"success": True, "allowed_count": len(server.enforcer.allowed_apps)}
    return {"success": False, "error": "WhitelistEnforcer not initialized"}

@app.get("/check-apps")
def check_apps():
    import server
    if hasattr(server, 'enforcer') and server.enforcer:
        unauthorized = server.enforcer.check_running_apps()
        return {"unauthorized_apps": unauthorized}
    return {"error": "Application monitor not initialized. Retry the system check."}

@app.get("/check-usb")
def check_usb():
    import server
    if hasattr(server, 'usb_monitor') and server.usb_monitor:
        removable = server.usb_monitor.check_for_existing_removable_drives()
        if server.usb_monitor.last_error:
            return {"error": server.usb_monitor.last_error}
        return {"removable_drives": removable}
    return {"error": "USB monitor not initialized. Retry the system check."}

@app.post("/kill-app")
def kill_app(payload: dict):
    import psutil
    import subprocess
    target = payload.get("name")
    if not target:
        return {"success": False, "error": "No app name provided"}
    
    target_lower = target.lower()
    killed = 0
    for proc in psutil.process_iter(['name', 'pid']):
        try:
            if proc.info.get('name', '').lower() == target_lower:
                proc.kill()
                killed += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
            
    # If psutil couldn't kill it (e.g. UWP / Windows Store app), try taskkill
    if killed == 0:
        try:
            res = subprocess.run(["taskkill", "/F", "/IM", target], capture_output=True)
            if res.returncode == 0:
                killed += 1
        except Exception:
            pass
            
    return {"success": True, "killed": killed}

import cv2
import base64
import numpy as np

# Pre-load face and profile cascades for fast alignment detection
_face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
_profile_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')

@app.post("/detect-face")
def detect_face(payload: dict):
    """
    Real-time face detector endpoint used by candidate Self-Check.
    Returns exact face centroid (normalized 0.0 to 1.0) and bounding box.
    """
    image_b64 = payload.get("image", "")
    if not image_b64:
        return {"detected": False, "count": 0}
    
    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
            
        img_bytes = base64.b64decode(image_b64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"detected": False, "count": 0}
            
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        faces = _face_cascade.detectMultiScale(
            gray, 
            scaleFactor=1.1, 
            minNeighbors=4, 
            minSize=(int(w * 0.15), int(h * 0.15))
        )
        
        # If frontal face not found, try profile face
        if len(faces) == 0 and not _profile_cascade.empty():
            profiles = _profile_cascade.detectMultiScale(
                gray, 
                scaleFactor=1.1, 
                minNeighbors=4, 
                minSize=(int(w * 0.15), int(h * 0.15))
            )
            if len(profiles) > 0:
                faces = profiles
                
        if len(faces) == 0:
            return {"detected": False, "count": 0}
            
        # Select largest detected face
        primary = max(faces, key=lambda b: b[2] * b[3])
        fx, fy, fw, fh = primary
        
        return {
            "detected": True,
            "count": int(len(faces)),
            "faceCenterX": float((fx + fw / 2.0) / w),
            "faceCenterY": float((fy + fh / 2.0) / h),
            "faceWidth": float(fw / w),
            "faceHeight": float(fh / h)
        }
    except Exception as e:
        return {"detected": False, "count": 0, "error": str(e)}

@app.post("/set-reference-voice")
def set_reference_voice(payload: dict):
    """
    Calibrates the candidate's reference voice from recorded audio during Self-Check.
    Accepts base64 audio data (WAV or raw PCM).
    """
    import server
    import os
    from voice_monitor import VoiceMonitor

    audio_b64 = payload.get("audio") or payload.get("audio_base64", "")
    session_id = payload.get("session_id") or os.environ.get("EXAM_SESSION_ID", "default-session")
    
    if not audio_b64:
        return {"success": False, "error": "No audio data provided"}

    try:
        if "," in audio_b64:
            audio_b64 = audio_b64.split(",", 1)[1]
            
        audio_bytes = base64.b64decode(audio_b64)
        
        confirmation = payload.get("confirmation_audio", "")
        confirmation_bytes = base64.b64decode(confirmation.split(",", 1)[-1]) if confirmation else None
        # Use existing VoiceMonitor instance if available on server
        if hasattr(server, 'voice_monitor') and server.voice_monitor:
            result = server.voice_monitor.set_reference_voice(audio_bytes, session_id=session_id, confirmation_audio=confirmation_bytes, microphone_label=payload.get("microphone_label"))
            return result
        else:
            # Create a temporary VoiceMonitor to calibrate and persist embedding to disk
            temp_vm = VoiceMonitor(session_id=session_id, is_self_check=True)
            result = temp_vm.set_reference_voice(audio_bytes, session_id=session_id, confirmation_audio=confirmation_bytes, microphone_label=payload.get("microphone_label"))
            return result
    except Exception as e:
        print(f"[Server Error] /set-reference-voice failed: {e}")
        return {"success": False, "error": str(e)}

@app.get("/check-voice")
def check_voice():
    """Returns the calibration status of the reference voice profile."""
    import server
    if hasattr(server, 'voice_monitor') and server.voice_monitor:
        has_ref = server.voice_monitor.reference_embedding is not None
        return {"calibrated": has_ref}
    return {"calibrated": False}

