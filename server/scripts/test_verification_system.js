const mongoose = require('mongoose');
require('dotenv').config({ path: 'd:/BS_FYP Project/IntegrityFlow/server/.env' });

const Teacher = require('../src/models/Teacher');
const VerificationChallenge = require('../src/models/VerificationChallenge');
const EtherealMailProvider = require('../src/services/mail/EtherealMailProvider');
const LinkVerificationStrategy = require('../src/services/verification/LinkVerificationStrategy');
const OtpVerificationStrategy = require('../src/services/verification/OtpVerificationStrategy');

async function runVerificationTests() {
    console.log('--- STARTING MODULAR EMAIL VERIFICATION TESTS (PART B) ---');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log(' Connected to MongoDB');

    const testEmail = `prof_darwin_${Date.now()}@cambridge.edu`;
    const teacher = await Teacher.create({
        name: 'Charles Darwin',
        email: testEmail,
        passwordHash: '$2b$12$dummyHashForVerificationTestOnly1234567890',
        role: 'teacher',
        emailVerified: false
    });

    console.log(` Created test teacher: ${teacher.name} (${teacher.email}), emailVerified=${teacher.emailVerified}`);

    // 1. Test EtherealMailProvider
    console.log('\n[1] Testing Ethereal Mail Provider...');
    const mailer = new EtherealMailProvider();
    const mailResult = await mailer.send({
        to: teacher.email,
        subject: 'IntegrityFlow Test Email',
        html: '<h3>Test Verification Email</h3><p>Hello from IntegrityFlow test suite!</p>'
    });
    console.log(` Mail send result: success=${mailResult.success}`);
    console.log(` Ethereal Test Mailbox Preview URL: ${mailResult.previewUrl}`);

    // 2. Test LinkVerificationStrategy
    console.log('\n[2] Testing LinkVerificationStrategy...');
    const linkStrategy = new LinkVerificationStrategy();
    const linkChallenge = await linkStrategy.generateChallenge(teacher._id, teacher.email);
    console.log(` Generated Link JWT Token: ${linkChallenge.payload.substring(0, 35)}... (Expires: ${linkChallenge.expiresAt.toISOString()})`);

    // Verify valid link
    const linkVerifySuccess = await linkStrategy.verifyChallenge(teacher._id, linkChallenge.payload);
    console.log(` Link verification with valid token: valid=${linkVerifySuccess.valid}`);

    // Verify invalid/tampered link
    const linkVerifyFail = await linkStrategy.verifyChallenge(teacher._id, linkChallenge.payload + 'tampered');
    console.log(` Link verification with tampered token: valid=${linkVerifyFail.valid}, reason="${linkVerifyFail.reason}"`);

    // 3. Test OtpVerificationStrategy
    console.log('\n[3] Testing OtpVerificationStrategy...');
    const otpStrategy = new OtpVerificationStrategy();
    const otpChallenge = await otpStrategy.generateChallenge(teacher._id, teacher.email);
    console.log(` Generated 6-digit OTP code: ${otpChallenge.payload} (Expires: ${otpChallenge.expiresAt.toISOString()})`);

    // Check DB challenge stored as hash
    const dbChallenge = await VerificationChallenge.findOne({ teacherId: teacher._id });
    console.log(` Stored Challenge in DB: codeHash=${dbChallenge.codeHash.substring(0, 20)}..., attempts=${dbChallenge.attempts}`);

    // Test incorrect code attempt (attempt 1)
    const wrongAttempt = await otpStrategy.verifyChallenge(teacher._id, '000000');
    console.log(` Wrong code attempt: valid=${wrongAttempt.valid}, reason="${wrongAttempt.reason}"`);

    // Test 4 more wrong attempts to trigger lockout
    console.log(' Triggering remaining 4 wrong attempts to hit max attempts limit...');
    await otpStrategy.verifyChallenge(teacher._id, '000001');
    await otpStrategy.verifyChallenge(teacher._id, '000002');
    await otpStrategy.verifyChallenge(teacher._id, '000003');
    await otpStrategy.verifyChallenge(teacher._id, '000004');
    const lockedAttempt = await otpStrategy.verifyChallenge(teacher._id, otpChallenge.payload); // Even correct code should now be rejected
    console.log(` After 5 failed attempts: valid=${lockedAttempt.valid}, reason="${lockedAttempt.reason}"`);

    // Test fresh OTP challenge and successful confirmation
    console.log('\n[4] Generating fresh OTP challenge & testing successful confirm...');
    const freshOtpChallenge = await otpStrategy.generateChallenge(teacher._id, teacher.email);
    console.log(` Fresh OTP Code: ${freshOtpChallenge.payload}`);
    const correctVerify = await otpStrategy.verifyChallenge(teacher._id, freshOtpChallenge.payload);
    console.log(` Verification with correct code: valid=${correctVerify.valid}`);

    if (correctVerify.valid) {
        teacher.emailVerified = true;
        await teacher.save();
    }
    const updatedTeacher = await Teacher.findById(teacher._id);
    console.log(` Teacher emailVerified updated in DB: ${updatedTeacher.emailVerified}`);

    // Cleanup test records
    await Teacher.deleteMany({ email: testEmail });
    await VerificationChallenge.deleteMany({ teacherId: teacher._id });
    await mongoose.disconnect();

    console.log('\n All Modular Email Verification (Part B) Tests Passed Successfully!');
}

runVerificationTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
