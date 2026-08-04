# Server Documentation

## What This Does
Server connects to MongoDB, exposes a health check endpoint, and implements the core violation-reporting pipeline. Real-time broadcasting via Socket.io is fully configured. Additionally, it supports Session Management and Exam Paper Distribution (with security gating). 
**New Module 5**: The server includes a real-time Severity Scoring Engine. Instead of treating every violation equally forever, the engine aggregates all violations for a student into a single `0-100` risk rating. This rating decays over time so that a single accidental head-turn earlier in the exam doesn't permanently flag a student, solving the "false-alert fatigue" issue identified in the scope document. 

## Design Decisions
**Decay Math and 0-100 Scaling:**
- **Time Decay**: We use an exponential decay formula `weight = severity * e^(-k * t)`. We configured the constant `k` so that the "half-life" of a violation is exactly 15 minutes. This means a severity 5 violation will only carry the weight of a 2.5 severity violation after 15 minutes. This mathematically models human proctoring logic: isolated issues in the past matter less than clustered, recent issues.
- **On-Demand Calculation**: We do not store the risk score in the database. Every time a score is requested (or broadcast), we recalculate it by fetching the session's violations. This avoids race conditions with concurrent violations saving at the exact same millisecond, which is simpler and more robust for the FYP scope.
- **Scaling to 0-100**: The raw sum of weights is divided by a baseline (e.g., 10 raw points maxes out the score) and capped at 100. This turns abstract math into a highly intuitive percentage-based badge for the dashboard users.

## How to Run
1. Ensure you have Node.js installed.
2. Navigate to the `server/` directory: `cd IntegrityFlow/server`
3. Install dependencies: `npm install`
4. Make sure `.env` is set up with `MONGODB_URI`, `SERVER_PORT`, and `DASHBOARD_URL`.
5. Start the development server using nodemon: `npm run dev`

## Files Changed/Added This Step
- `src/scoring/severityEngine.js`: Contains the mathematical logic (`calculateRiskScore`) to decay and normalize violation severity.
- `src/routes/riskScore.js`: Provides the `GET /risk-score/:sessionId` endpoint to manually fetch a calculated score.
- `src/sockets/violationSocket.js`: Added the `broadcastRiskScoreUpdate` function to push new scores immediately.
- `src/routes/violations.js`: Updated to calculate and push the new risk score down the socket pipe every time a new violation is created.
- `src/index.js`: Mounted the new `/risk-score` router.

## Next Steps
- Backend MVP is completely FEATURE-COMPLETE! 
- Next phase: Build the React Dashboard interface to consume these APIs.

## Testing This Step
Run these curl commands to test the scoring engine. Try posting multiple violations, waiting a minute, and posting another to see how the score changes.

**1. Create an active session:**
```bash
curl -X POST http://localhost:5000/sessions \
  -H "Content-Type: application/json" \
  -d '{ "studentId": "std-999", "examId": "CS101" }'
```

**2. POST a severe violation:**
```bash
curl -X POST http://localhost:5000/violation \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session-xyz123",
    "type": "unauthorized_object",
    "severity": 5,
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
  }'
```
*(Note: change 'session-xyz123' to match your actual sessionId from Step 1, or just reuse 'session-xyz123' for testing the math).*

**3. Fetch the Risk Score:**
```bash
curl -X GET http://localhost:5000/risk-score/session-xyz123
```
*You should see a JSON object with the `riskScore` capped at a max of 100, the `violationCount` equal to 1, and the `lastViolationAt` timestamp.*
