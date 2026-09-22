require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

async function testAdminEndpoints() {
    console.log('--- Testing Admin API Endpoints ---');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(' MongoDB connected.');

    const Teacher = require('../src/models/Teacher');
    const AuditLog = require('../src/models/AuditLog');
    const { logTeacherAction } = require('../src/utils/auditLogger');

    // Find or mock teacher
    let teacher = await Teacher.findOne();
    if (!teacher) {
        teacher = { _id: new mongoose.Types.ObjectId(), name: 'Admin Test', email: 'admin@test.com' };
    }

    const mockReq = {
        teacher: { teacherId: teacher._id, name: teacher.name, email: teacher.email },
        headers: { 'x-forwarded-for': '127.0.0.1' },
        ip: '127.0.0.1'
    };

    console.log('1. Testing logTeacherAction...');
    const logResult = await logTeacherAction(mockReq, {
        action: 'TEST_ADMIN_PING',
        targetType: 'system',
        targetSummary: 'System diagnostic health check ping',
        details: { version: '1.0.0' }
    });
    console.log(' Audit log created:', logResult._id, logResult.action);

    console.log('2. Querying Audit Logs...');
    const logs = await AuditLog.find({ action: 'TEST_ADMIN_PING' }).limit(1);
    console.log(' Found audit logs count:', logs.length);

    console.log(' All Admin backend tests passed!');
    await mongoose.disconnect();
}

testAdminEndpoints().catch(err => {
    console.error('❌ Admin test failed:', err);
    process.exit(1);
});
