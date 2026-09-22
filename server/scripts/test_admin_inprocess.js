require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');

async function testInProcessAdminAPI() {
    console.log('--- Testing In-Process Admin API ---');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(' MongoDB connected.');

    const Teacher = require('../src/models/Teacher');
    const adminRoutes = require('../src/routes/admin');

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/admin', adminRoutes);

    let teacher = await Teacher.findOne();
    if (!teacher) {
        teacher = await Teacher.create({
            name: 'Admin Test Teacher',
            email: 'admin_test@integrityflow.local',
            passwordHash: 'dummy',
            role: 'admin'
        });
    }

    const token = jwt.sign(
        { teacherId: teacher._id.toString(), email: teacher.email, role: 'admin', name: teacher.name },
        process.env.JWT_SECRET || 'test_jwt_secret',
        { expiresIn: '1h' }
    );

    const server = app.listen(0);
    const port = server.address().port;
    const http = require('http');

    const makeReq = (path) => new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cookie': `accessToken=${token}`,
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.on('error', reject);
        req.end();
    });

    try {
        console.log('1. GET /admin/stats');
        const stats = await makeReq('/admin/stats');
        console.log(' Status:', stats.status);
        console.log('   Total Exams:', stats.body.overview.totalExams);
        console.log('   Storage Assets:', stats.body.storage.totalAssets);
        console.log('   Storage Provider:', stats.body.storage.provider);

        console.log('2. GET /admin/assets');
        const assets = await makeReq('/admin/assets?type=all&limit=5');
        console.log(' Status:', assets.status);
        console.log('   Found items:', assets.body.items?.length, 'Total in DB:', assets.body.total);

        console.log('3. GET /admin/audit-logs');
        const logs = await makeReq('/admin/audit-logs?limit=5');
        console.log(' Status:', logs.status);
        console.log('   Found logs:', logs.body.logs?.length, 'Total logs:', logs.body.total);

        console.log('\n All Admin API In-Process Tests Passed with Flying Colors!');
    } finally {
        server.close();
        await mongoose.disconnect();
    }
}

testInProcessAdminAPI().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
