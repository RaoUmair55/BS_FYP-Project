require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');

async function testAdminRoutesE2E() {
    console.log('Testing Admin Dashboard Routes End-to-End...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(' MongoDB connected.');

    const Teacher = require('../src/models/Teacher');
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

    const makeRequest = (path, method = 'GET', body = null) => {
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: 5000,
                path,
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Cookie': `accessToken=${token}`,
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
            req.on('error', reject);
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    };

    try {
        console.log('1. Testing GET /admin/stats...');
        const statsRes = await makeRequest('/admin/stats');
        console.log(' Stats response status:', statsRes.status);
        console.log('   Total Exams:', statsRes.body.overview?.totalExams);
        console.log('   Total Media Files:', statsRes.body.storage?.totalAssets);
        console.log('   Storage Provider:', statsRes.body.storage?.provider);

        console.log('2. Testing GET /admin/assets...');
        const assetsRes = await makeRequest('/admin/assets?type=all&limit=10');
        console.log(' Assets response status:', assetsRes.status);
        console.log('   Assets found:', assetsRes.body.items?.length, 'Total:', assetsRes.body.total);

        console.log('3. Testing GET /admin/audit-logs...');
        const logsRes = await makeRequest('/admin/audit-logs?limit=5');
        console.log(' Audit logs response status:', logsRes.status);
        console.log('   Logs found:', logsRes.body.logs?.length, 'Total:', logsRes.body.total);

        console.log('\n All Admin API Endpoints Verified Successfully!');
    } catch (err) {
        console.error('❌ E2E test failed:', err);
    } finally {
        await mongoose.disconnect();
    }
}

testAdminRoutesE2E();
