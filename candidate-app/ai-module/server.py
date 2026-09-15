from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/violation")
def log_violation(payload: dict):
    print("Violation logged:", payload)
    return payload

@app.get("/check-apps")
def check_apps():
    import server
    if hasattr(server, 'enforcer') and server.enforcer:
        unauthorized = server.enforcer.check_running_apps()
        return {"unauthorized_apps": unauthorized}
    return {"unauthorized_apps": []}

@app.post("/kill-app")
def kill_app(payload: dict):
    import psutil
    target = payload.get("name")
    if not target:
        return {"success": False, "error": "No app name provided"}
    
    target_lower = target.lower()
    killed = 0
    for proc in psutil.process_iter(['name']):
        try:
            if proc.info.get('name', '').lower() == target_lower:
                proc.kill()
                killed += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return {"success": True, "killed": killed}
