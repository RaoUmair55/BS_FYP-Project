import time
import requests

URL = "http://localhost:3000/violations"

PAYLOAD = {
  "sessionId": "sim-session-123",
  "type": "head_turn_away",
  "severity": 3,
  "timestamp": "2024-05-01T12:00:00Z",
  "details": {
    "confidence": 0.95,
    "duration": 5
  }
}

for i in range(5):
    try:
        res = requests.post(URL, json=PAYLOAD)
        print(f"[{i+1}/5] Sent violation event, status: {res.status_code}")
    except Exception as e:
        print(f"Failed to send: {e}")
    time.sleep(5)
