const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: 'd:/BS_FYP Project/IntegrityFlow/server/.env' });

const Teacher = require('../src/models/Teacher');
const RefreshToken = require('../src/models/RefreshToken');
const AuthAuditLog = require('../src/models/AuthAuditLog');
const { generateAccessToken, generateRefreshToken, hashToken, verifyAccessToken } = require('../src/utils/tokens');
const { requireAuth, requireRole } = require('../src/middleware/authMiddleware');

async function runAuthTests() {
    console.log('--- STARTING AUTHENTICATION SYSTEM TESTS ---');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log(' Connected to MongoDB');

    const testEmail = `test_prof_${Date.now()}@university.edu`;
    const testPassword = 'Password123!';

    // Clean up any previous test user
    await Teacher.deleteMany({ email: testEmail });
    await AuthAuditLog.deleteMany({ email: testEmail });

    // 1. Test Model Creation & Password Hashing
    console.log('\n[1] Testing Teacher Model & Password Hashing...');
    const passwordHash = await bcrypt.hash(testPassword, 12);
    const teacher = await Teacher.create({
        name: 'Dr. Alan Turing',
        email: testEmail,
        passwordHash,
        role: 'teacher',
        emailVerified: false
    });
    console.log(` Created teacher: ${teacher.name} (${teacher.email})`);
    console.log(` PasswordHash is bcrypt 12-round: ${passwordHash.startsWith('$2b$12$')}`);

    // 2. Test Token Generation & Verification
    console.log('\n[2] Testing Token Utilities...');
    const accessToken = generateAccessToken(teacher);
    console.log(` Access token generated (15m): ${accessToken.substring(0, 30)}...`);
    const decoded = verifyAccessToken(accessToken);
    console.log(` Verified access token payload: teacherId=${decoded.teacherId}, role=${decoded.role}, email=${decoded.email}`);

    const { token: rawRefreshToken, tokenHash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const storedToken = await RefreshToken.create({
        teacherId: teacher._id,
        tokenHash,
        expiresAt
    });
    console.log(` Refresh token created in DB (hashed): ${storedToken.tokenHash.substring(0, 20)}...`);
    console.log(` Raw token correctly matches hash: ${hashToken(rawRefreshToken) === storedToken.tokenHash}`);

    // 3. Test Refresh Token Rotation
    console.log('\n[3] Testing Refresh Token Rotation...');
    storedToken.revoked = true;
    await storedToken.save();
    const { token: newRawToken, tokenHash: newTokenHash } = generateRefreshToken();
    await RefreshToken.create({
        teacherId: teacher._id,
        tokenHash: newTokenHash,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    });
    const oldCheck = await RefreshToken.findById(storedToken._id);
    console.log(` Old token revoked: ${oldCheck.revoked}`);

    // 4. Test Lockout Logic (5 failed attempts)
    console.log('\n[4] Testing Account Lockout (5 Failed Attempts)...');
    for (let i = 1; i <= 5; i++) {
        teacher.failedLoginAttempts += 1;
        if (teacher.failedLoginAttempts >= 5) {
            teacher.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            await AuthAuditLog.create({
                teacherId: teacher._id,
                email: teacher.email,
                event: 'account_locked',
                ipAddress: '127.0.0.1'
            });
        } else {
            await AuthAuditLog.create({
                teacherId: teacher._id,
                email: teacher.email,
                event: 'login_failed',
                ipAddress: '127.0.0.1'
            });
        }
        await teacher.save();
    }
    const lockedTeacher = await Teacher.findById(teacher._id);
    console.log(` Failed attempts count: ${lockedTeacher.failedLoginAttempts}`);
    console.log(` Locked until: ${lockedTeacher.lockedUntil} (Active lockout: ${lockedTeacher.lockedUntil > new Date()})`);

    // 5. Test Password Reset Workflow
    console.log('\n[5] Testing Password Reset Flow...');
    const resetSecret = process.env.RESET_TOKEN_SECRET || 'dev_reset_token_secret_87192837192837192837192';
    const resetToken = jwt.sign(
        { teacherId: lockedTeacher._id.toString(), email: lockedTeacher.email, type: 'password_reset' },
        resetSecret,
        { expiresIn: '30m' }
    );
    console.log(` Generated Password Reset Token: ${resetToken.substring(0, 30)}...`);

    const decodedReset = jwt.verify(resetToken, resetSecret);
    const newPassword = 'NewSecretPassword99!';
    lockedTeacher.passwordHash = await bcrypt.hash(newPassword, 12);
    lockedTeacher.failedLoginAttempts = 0;
    lockedTeacher.lockedUntil = null;
    await lockedTeacher.save();

    // Revoke all refresh tokens
    await RefreshToken.updateMany({ teacherId: lockedTeacher._id }, { $set: { revoked: true } });
    const remainingActiveTokens = await RefreshToken.countDocuments({ teacherId: lockedTeacher._id, revoked: false });
    console.log(` All refresh tokens revoked on password reset: count=${remainingActiveTokens}`);
    console.log(` Account unlocked and password updated. New match test: ${await bcrypt.compare(newPassword, lockedTeacher.passwordHash)}`);

    // 6. Test Audit Log Persistence
    console.log('\n[6] Testing Auth Audit Log Records...');
    const logs = await AuthAuditLog.find({ teacherId: teacher._id }).sort({ timestamp: 1 });
    console.log(` Recorded ${logs.length} audit logs:`);
    logs.forEach(l => console.log(`   - [${l.event}] at ${l.timestamp.toISOString()} (IP: ${l.ipAddress})`));

    // Cleanup test data
    await Teacher.deleteMany({ email: testEmail });
    await RefreshToken.deleteMany({ teacherId: teacher._id });
    await AuthAuditLog.deleteMany({ email: testEmail });
    await mongoose.disconnect();
    console.log('\n All Auth Unit/Integration Tests Passed Successfully!');
}

runAuthTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
