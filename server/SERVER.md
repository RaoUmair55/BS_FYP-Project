# IntegrityFlow Server Documentation

## What This Does
The IntegrityFlow backend is a robust Node.js/Express and MongoDB service providing real-time AI-powered exam proctoring coordination, candidate session management, automated risk-decay scoring engines, Socket.io event broadcasting, and an **industry-standard authentication and authorization system** for educators and administrators.

### Core Authentication & Security (Part A)
- **Role-Based Instructor Accounts**: Protects teacher and admin workflows (`Teacher` model) with password hashing (bcrypt, 12 rounds).
- **Dual-Token Authentication Split**: Issues short-lived JWT access tokens (15 minutes) for API authorization and long-lived cryptographically secure random refresh tokens (14 days) with automatic rotation.
- **Defense in Depth**: Express rate limiting on sensitive auth endpoints, brute-force account lockouts (15-minute lock after 5 failed attempts), constant-time comparisons, generic error messaging, HTTP security headers via `helmet`, and audit trails (`AuthAuditLog`).
- **Teacher Route Protection**: Enforces JWT verification via `requireAuth` on all examiner endpoints (`/exams`, `/sessions/active`, `/violations`, `/risk-score`), while keeping machine-to-machine candidate routes (such as `POST /violation` and `POST /sessions`) open.

### Standalone Modular Email Verification (Part B)
- **Decoupled Verification Architecture**: Built and fully tested verification subsystem using the **Strategy Pattern** (`LinkVerificationStrategy` for magic links, `OtpVerificationStrategy` for 6-digit numeric codes) alongside a **Mail Provider Interface** (`MailProvider`, `EtherealMailProvider`).
- **Built But Disconnected**: The email verification service and router (`src/routes/verification.js`) are fully implemented and unit/integration tested, but **intentionally not yet wired into the live signup/login flow** or mounted in `index.js`. This allows the current frontend and test suites to operate unhindered while keeping verification ready for 1-click activation.

---

## Architecture Note

### 1. Access / Refresh Token Split and Rotation
- **Access Tokens (JWT)**: Contain lightweight claims (`teacherId`, `email`, `role`) signed with `JWT_SECRET` with a 15-minute expiry. They are returned in JSON response bodies and kept in frontend in-memory state (never `localStorage` or un-scoped cookies) to mitigate Cross-Site Scripting (XSS) persistent token theft.
- **Refresh Tokens (Hashed & httpOnly Cookie)**: Refresh tokens are generated as 40-byte cryptographically secure random hex strings (`crypto.randomBytes`). The server stores only the **SHA-256 hash** of the refresh token in the `RefreshToken` collection, never raw tokens. The raw token is sent to the client exclusively inside an `httpOnly`, `secure`, `sameSite: strict` cookie.
- **Token Rotation**: Every time `/auth/refresh` is called, the old refresh token is marked `revoked: true` in MongoDB, and a brand-new refresh token is issued and set in the cookie. If a stolen refresh token is reused, the rotation trail invalidates the session.

### 2. Machine-to-Machine Candidate App vs Teacher Routes
- **`POST /violation` & `POST /sessions` (Open)**: Candidate Electron client runs on student machines during an exam. These endpoints receive proctoring telemetry, webcam check snapshots, and AI violation events machine-to-machine. Requiring instructor credentials here would break candidate desktop app execution.
- **Teacher-Facing Routes (Protected)**: Exam creation, question paper uploads, viewing student violation feeds, triage reviews, and risk scores require valid teacher authentication.

### 3. Strategy Pattern for Email Verification
### 3. Strategy & Provider Patterns (Modular Subsystems)
- The verification system decouples token/code generation and validation from delivery.
- `VerificationStrategy` interface defines `generateChallenge` and `verifyChallenge`.
  - `LinkVerificationStrategy` uses signed JWTs for 1-click email links.
  - `OtpVerificationStrategy` uses random 6-digit codes with SHA-256 DB storage, 10-minute expiry, and a strict 5-attempt limit before invalidation.
- `MailProvider` interface defines `send({ to, subject, html, text })`. The system ships with `EtherealMailProvider` (zero-configuration test SMTP with live web preview URLs), and can swap to SendGrid or Resend in production by changing one line in `src/services/mail/index.js`.

---

## Architecture — Modular Design (Dependency Inversion Principle)

IntegrityFlow enforces the **Dependency Inversion Principle (DIP)** from the **SOLID** software engineering design principles across all backend and client services:
> *"High-level modules should not depend on low-level modules. Both should depend on abstractions. Abstractions should not depend on details. Details should depend on abstractions."*

Rather than having route handlers and business logic directly depend on concrete I/O mechanisms (e.g. disk storage, SMTP libraries, or mathematical algorithms), every critical domain in IntegrityFlow adheres to a consistent 3-tier structure:
1. **Interface Contract (`Provider` / `Strategy` base class)**: Declares required method signatures, parameters, and return types, throwing descriptive errors if called directly.
2. **Concrete Implementation (`Local*`, `Decay*`, `Ethereal*`)**: Encapsulates the specific runtime technology or algorithm without leaking implementation details.
3. **Single Swap Point (`index.js`)**: Exports the active default instance and class definitions, enabling zero-downtime swapping of drivers (e.g., swapping local disk for AWS S3, or switching decay scoring for ML-based scoring) in exactly one line of code.

### Summary of Modular Subsystems:
| Domain | Abstract Interface | Default Implementation | Pluggable Future Alternatives | Swap Point |
|---|---|---|---|---|
| **Storage** | `StorageProvider` (`save`, `getUrl`, `delete`, `exists`, `getAbsolutePath`) | `LocalStorageProvider` (Local FS) | `S3StorageProvider`, `AzureBlobStorageProvider`, `GCSStorageProvider` | `src/services/storage/index.js` |
| **Scoring Engine** | `ScoringStrategy` (`calculateScore`) | `DecayScoringStrategy` (Exponential 15m Half-Life) | `LinearScoringStrategy`, `WeightedAverageStrategy`, `MLScoringStrategy` | `src/services/scoring/index.js` |
| **Email Delivery** | `MailProvider` (`send`) | `EtherealMailProvider` (Nodemailer Ethereal) | `SendGridMailProvider`, `ResendMailProvider`, `SesMailProvider` | `src/services/mail/index.js` |
| **Verification** | `VerificationStrategy` (`generateChallenge`, `verifyChallenge`) | `LinkVerificationStrategy` / `OtpVerificationStrategy` | `SmsVerificationStrategy`, `BiometricVerificationStrategy` | `src/services/verification/index.js` |

This modular design guarantees that:
- **Testability**: Any provider or strategy can be instantly mocked without touching route handlers.
- **Maintainability**: Low-level infrastructure changes (e.g. migrating uploads to an S3 bucket or changing email vendors) require zero modifications to route files.
- **Viva / Exam Readiness**: Demonstrates clear real-world mastery of SOLID design principles, Separation of Concerns (SoC), and the Strategy/Adapter Design Patterns.

---

## Files Changed/Added

### Part A — Core Authentication System
- `src/models/Teacher.js` — Instructor user schema (`name`, `email`, `passwordHash`, `role`, `emailVerified`, `failedLoginAttempts`, `lockedUntil`, `createdAt`).
- `src/models/RefreshToken.js` — Refresh token store with SHA-256 `tokenHash`, `teacherId`, `expiresAt`, `revoked`.
- `src/models/AuthAuditLog.js` — Security audit trail logging signup, login, lockout, and password reset events with IP addresses.
- `src/utils/tokens.js` — Utility functions for signing/verifying JWT access tokens and generating/hashing refresh tokens.
- `src/middleware/authMiddleware.js` — `requireAuth` (Bearer token parser) and `requireRole` route authorization middleware.
- `src/routes/auth.js` — Endpoints: `/auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/me`.
- `src/routes/violations.js` — Added `requireAuth` to teacher GET and review endpoints while keeping `POST /violation` unauthenticated.
- `src/routes/sessions.js` — Protected teacher triage, terminate, warn, and active session listing routes.
- `src/routes/exams.js` — Protected exam creation, deletion, status modification, and analytics routes.
- `src/routes/examPaper.js` — Protected exam paper uploads and listings.
- `src/routes/riskScore.js` — Protected risk score calculation endpoint.
- `src/index.js` — Applied `helmet()`, `cookieParser()`, and mounted `/auth`.
- `.env.example` & `.env` — Added `JWT_SECRET`, `RESET_TOKEN_SECRET`, `EMAIL_TOKEN_SECRET`, and `REQUIRE_EMAIL_VERIFICATION`.

### Part B — Modular Email Verification Subsystem
- `src/services/mail/MailProvider.js` — Abstract mail provider interface.
- `src/services/mail/EtherealMailProvider.js` — Nodemailer Ethereal SMTP implementation with cached transporter and live preview URLs.
- `src/services/mail/index.js` — Provider factory / exporter.
- `src/models/VerificationChallenge.js` — Schema for OTP verification challenges (`teacherId`, `codeHash`, `expiresAt`, `attempts`).
- `src/services/verification/VerificationStrategy.js` — Abstract verification strategy interface.
- `src/services/verification/LinkVerificationStrategy.js` — JWT magic link verification strategy.
- `src/services/verification/OtpVerificationStrategy.js` — 6-digit OTP code verification strategy with 5-attempt lockout.
- `src/services/verification/index.js` — Strategy selector / exporter.
- `src/routes/verification.js` — Verification API (`POST /verification/send`, `POST /verification/confirm`) ready for mounting.

### Part C — Modular Storage & Scoring Refactor
- `src/services/storage/StorageProvider.js` — Abstract storage provider interface (`save`, `getUrl`, `delete`, `exists`, `getAbsolutePath`).
- `src/services/storage/LocalStorageProvider.js` — Concrete filesystem storage provider with path sanitization and directory initialization.
- `src/services/storage/index.js` — Storage provider singleton exporter / swap point.
- `src/services/scoring/ScoringStrategy.js` — Abstract scoring strategy interface (`calculateScore(violations, referenceTime)`).
- `src/services/scoring/DecayScoringStrategy.js` — Concrete decay scoring strategy preserving the 15-minute half-life exponential formula.
- `src/services/scoring/index.js` — Scoring strategy singleton exporter / swap point.
- `src/scoring/severityEngine.js` — Refactored to delegate mathematical scoring to `scoringStrategy`.
- `scripts/test_auth_system.js` — Automated unit/integration test suite for Part A.
- `scripts/test_verification_system.js` — Automated integration test suite for Part B.
- `scripts/test_http_endpoints.js` — HTTP end-to-end endpoint test suite.

---

## Security Notes (For Report / Viva Use)
1. **Password Security**: Passwords hashed using bcrypt with salt work factor of 12. Never logged or returned in API responses.
2. **Brute-Force Protection & Lockout**:
   - Express rate limiters restrict `/auth/login` to 10 attempts per 15 minutes per IP.
   - 5 consecutive failed login attempts trigger a 15-minute account lock (`lockedUntil`).
3. **Anti-Enumeration Safeguards**:
   - Login failures always return the uniform generic response: `"Invalid email or password"`.
   - `/auth/forgot-password` returns `"If an account with that email exists, a password reset link has been sent."` whether the email exists or not.
4. **Token Security & Storage**:
   - Refresh tokens stored as SHA-256 hashes in the database.
   - Refresh cookies set with `httpOnly: true`, `sameSite: 'strict'`, and `secure: true` in production.
   - Password reset revokes all existing refresh tokens across all devices.
5. **Audit Logging**: All security-critical events (signups, logins, failed attempts, lockouts, password resets) are recorded in `AuthAuditLog` with client IP and timestamps.

---

## Testing This Step

### Automated Test Suites
Run the automated test scripts from `server/`:

```bash
# 1. Run Part A Unit & Flow Tests
node scripts/test_auth_system.js

# 2. Run Part B Verification & Mailer Tests
node scripts/test_verification_system.js

# 3. Run End-to-End HTTP Route Tests (while server is running)
node scripts/test_http_endpoints.js
```

### Manual Testing with cURL / Postman

#### 1. Teacher Signup
```bash
curl -X POST http://localhost:5000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dr. Alan Turing",
    "email": "alan.turing@university.edu",
    "password": "SecurePassword123!",
    "role": "teacher"
  }' -c cookies.txt
```

#### 2. Teacher Login
```bash
curl -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alan.turing@university.edu",
    "password": "SecurePassword123!"
  }' -c cookies.txt
```

#### 3. Access Protected Route (e.g. GET /auth/me or GET /exams)
```bash
curl -X GET http://localhost:5000/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

#### 4. Refresh Token Rotation
```bash
curl -X POST http://localhost:5000/auth/refresh \
  -b cookies.txt -c cookies.txt
```

#### 5. Trigger 5 Failed Logins (Confirm Lockout)
```bash
for i in {1..5}; do
  curl -X POST http://localhost:5000/auth/login \
    -H "Content-Type: application/json" \
    -d '{ "email": "alan.turing@university.edu", "password": "WrongPassword!" }'
done
```

#### 6. Request & Reset Password
```bash
# Request reset
curl -X POST http://localhost:5000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{ "email": "alan.turing@university.edu" }'

# Reset password using token printed in server console
curl -X POST http://localhost:5000/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<RESET_TOKEN>",
    "newPassword": "BrandNewPassword99!"
  }'
```

#### 7. Part B: Test Email Verification
Run `node scripts/test_verification_system.js` to see Ethereal test emails generated with preview URLs, and test Link vs OTP challenge verification with lockout.

---

## How To Activate Verification Later

When you are ready to enforce email verification across the platform, follow this 4-step checklist:

1. **Enable Feature Flag**:
   In `server/.env`, set:
   ```env
   REQUIRE_EMAIL_VERIFICATION=true
   ```

2. **Update Signup Route (`src/routes/auth.js`)**:
   - In `POST /auth/signup`, after creating the `Teacher` record, invoke the verification service:
     ```javascript
     const verificationStrategy = require('../services/verification');
     const mailService = require('../services/mail');
     
     const challenge = await verificationStrategy.generateChallenge(savedTeacher._id, savedTeacher.email);
     await mailService.send({ to: savedTeacher.email, subject: 'Verify Email', html: '...' });
     ```
   - Stop auto-returning access/refresh tokens upon signup if `process.env.REQUIRE_EMAIL_VERIFICATION === 'true'`, prompting the user to check their email first.

3. **Enforce Verification on Login (`src/routes/auth.js`)**:
   - In `POST /auth/login`, add a check before generating tokens:
     ```javascript
     if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !teacher.emailVerified) {
         return res.status(403).json({
             error: 'Please verify your email address before logging in.',
             code: 'EMAIL_NOT_VERIFIED',
             teacherId: teacher._id
         });
     }
     ```

4. **Mount Verification Router (`src/index.js`)**:
   - Add to `src/index.js`:
     ```javascript
     app.use('/verification', require('./routes/verification'));
     ```
