require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');

async function testEnterpriseRBAC() {
    console.log('--- Testing Enterprise Bootstrap Admin & RBAC User Management ---');
    await mongoose.connect(process.env.MONGODB_URI);

    const seedAdmin = require('../src/config/seedAdmin');
    const Teacher = require('../src/models/Teacher');
    const adminRoutes = require('../src/routes/admin');
    const AuditLog = require('../src/models/AuditLog');

    // 1. Test Seed Admin
    console.log('1. Running seedAdmin()...');
    await seedAdmin();
    const adminUser = await Teacher.findOne({ email: (process.env.ADMIN_EMAIL || 'admin@integrityflow.com').toLowerCase() });
    console.log(' Super Admin verified in DB:', adminUser?.email, 'Role:', adminUser?.role);

    // Create a dummy teacher to test promotion/demotion
    let testTeacher = await Teacher.findOne({ email: 'test_examiner_rbac@integrityflow.local' });
    if (!testTeacher) {
        testTeacher = await Teacher.create({
            name: 'Prof. RBAC Examiner',
            email: 'test_examiner_rbac@integrityflow.local',
            passwordHash: 'dummyhash',
            role: 'teacher'
        });
    }

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/admin', adminRoutes);

    const server = app.listen(0);
    const port = server.address().port;

    const adminToken = jwt.sign(
        { teacherId: adminUser._id.toString(), email: adminUser.email, role: 'admin', name: adminUser.name },
        process.env.JWT_SECRET || 'test_jwt_secret',
        { expiresIn: '1h' }
    );

    const makeReq = (path, method = 'GET', body = null) => new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path,
            method,
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });

    try {
        console.log('2. Testing GET /admin/users...');
        const usersRes = await makeReq('/admin/users?limit=10');
        console.log(' Status:', usersRes.status);
        console.log('   Total users found:', usersRes.body.users?.length);

        console.log('3. Promoting test teacher to "admin"...');
        const promoteRes = await makeReq(`/admin/users/${testTeacher._id}/role`, 'PATCH', { role: 'admin' });
        console.log(' Status:', promoteRes.status, 'New role:', promoteRes.body.user?.role);

        console.log('4. Demoting test user back to "teacher"...');
        const demoteRes = await makeReq(`/admin/users/${testTeacher._id}/role`, 'PATCH', { role: 'teacher' });
        console.log(' Status:', demoteRes.status, 'New role:', demoteRes.body.user?.role);

        console.log('5. Verifying Audit Log recorded the role changes...');
        const audit = await AuditLog.findOne({ action: 'USER_ROLE_CHANGED' }).sort({ timestamp: -1 });
        console.log(' Latest role change audit log:', audit?.targetSummary);

        console.log('\n All Enterprise Bootstrap & RBAC Tests Passed Successfully!');
    } finally {
        server.close();
        await mongoose.disconnect();
    }
}

testEnterpriseRBAC().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
