require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');

async function testRoleEnforcement() {
    console.log('--- Testing Admin-Only Role Enforcement ---');
    await mongoose.connect(process.env.MONGODB_URI);

    const adminRoutes = require('../src/routes/admin');
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/admin', adminRoutes);

    const server = app.listen(0);
    const port = server.address().port;

    const teacherToken = jwt.sign(
        { teacherId: '661234567890abcdef123456', email: 'teacher@test.com', role: 'teacher', name: 'Regular Teacher' },
        process.env.JWT_SECRET || 'test_jwt_secret',
        { expiresIn: '1h' }
    );

    const adminToken = jwt.sign(
        { teacherId: '661234567890abcdef123457', email: 'admin@test.com', role: 'admin', name: 'Super Admin' },
        process.env.JWT_SECRET || 'test_jwt_secret',
        { expiresIn: '1h' }
    );

    const reqWithToken = (token) => new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/admin/stats',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.end();
    });

    try {
        console.log('1. Testing Regular Teacher token (role: "teacher")...');
        const resTeacher = await reqWithToken(teacherToken);
        console.log(` Status: ${resTeacher.status} (Expected: 403 Forbidden)`);
        if (resTeacher.status === 403) {
            console.log(' Non-admin access was blocked as expected.');
        } else {
            throw new Error(`Expected 403 but received ${resTeacher.status}`);
        }

        console.log('2. Testing Admin token (role: "admin")...');
        const resAdmin = await reqWithToken(adminToken);
        console.log(` Status: ${resAdmin.status} (Expected: 200 OK)`);
        if (resAdmin.status === 200) {
            console.log(' Admin access granted successfully.');
        } else {
            throw new Error(`Expected 200 but received ${resAdmin.status}`);
        }

        console.log('\n All Role Enforcement Tests Passed Successfully!');
    } finally {
        server.close();
        await mongoose.disconnect();
    }
}

testRoleEnforcement().catch(err => {
    console.error('❌ Role test error:', err);
    process.exit(1);
});
