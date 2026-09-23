from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health_check():
    return {"status": "ok"}

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
    return {"unauthorized_apps": []}

@app.get("/check-usb")
def check_usb():
    import server
    if hasattr(server, 'usb_monitor') and server.usb_monitor:
        removable = server.usb_monitor.check_for_existing_removable_drives()
        return {"removable_drives": removable}
    return {"removable_drives": []}

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

