from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/violation")
def log_violation(payload: dict):
    print("Violation logged:", payload)
    return payload
