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
