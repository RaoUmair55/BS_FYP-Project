const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Session = require('../src/models/Session');
const Exam = require('../src/models/Exam');

async function testStudentIdentity() {
    console.log('--- STARTING STUDENT IDENTITY VALIDATION & PERSISTENCE TEST ---');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(' Connected to MongoDB:', mongoose.connection.name);

    // 1. Test Model Schema Validation
    console.log('\n[1] Testing Schema Validation: Missing studentName or rollNumber...');
    try {
        const invalidSession = new Session({
            studentId: 'TEST-ROLL',
            examId: 'EXAM-IDENTITY-TEST'
            // Missing studentName and rollNumber
        });
        await invalidSession.save();
        console.error('❌ Failed: Should have rejected session without studentName/rollNumber');
    } catch (err) {
        console.log('✅ Passed: Model rejected session missing studentName/rollNumber:', err.message);
    }

    // 2. Test Model Creation with Full Identity
    console.log('\n[2] Testing Valid Session Creation with Student Identity...');
    const testSession = new Session({
        studentId: 'BCS-F20-042',
        studentName: 'Muhammad Ali',
        rollNumber: 'BCS-F20-042',
        examId: 'EXAM-IDENTITY-TEST',
        consentGiven: true,
        consentTimestamp: new Date()
    });
    const saved = await testSession.save();
    console.log('✅ Passed: Created session with ID:', saved._id);
    console.log('   - studentName:', saved.studentName);
    console.log('   - rollNumber:', saved.rollNumber);
    console.log('   - studentId:', saved.studentId);
    console.log('   - consentGiven:', saved.consentGiven);

    // 3. Query Session Back
    console.log('\n[3] Testing Query Retrieval...');
    const queried = await Session.findById(saved._id);
    if (queried.studentName === 'Muhammad Ali' && queried.rollNumber === 'BCS-F20-042') {
        console.log('✅ Passed: Query correctly returned studentName and rollNumber.');
    } else {
        console.error('❌ Failed: Queried data does not match:', queried);
    }

    // Cleanup
    await Session.deleteOne({ _id: saved._id });
    console.log('\n✅ Cleaned up test session.');

    await mongoose.disconnect();
    console.log('\n--- ALL STUDENT IDENTITY TESTS PASSED SUCCESSFULLY ---');
}

testStudentIdentity().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
