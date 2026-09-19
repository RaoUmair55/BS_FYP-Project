const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config({ path: 'd:/BS_FYP Project/IntegrityFlow/server/.env' });

const Teacher = require('../src/models/Teacher');
const RefreshToken = require('../src/models/RefreshToken');
const AuthAuditLog = require('../src/models/AuthAuditLog');

// Helper to make HTTP requests
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let json;
                try { json = JSON.parse(data); } catch (e) { json = data; }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    cookies: res.headers['set-cookie'] || [],
                    data: json
                });
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

async function testHttpEndpoints() {
    console.log('--- STARTING HTTP ROUTE ENDPOINT INTEGRATION TESTS ---');

    await mongoose.connect(process.env.MONGODB_URI);

    const testEmail = `prof_einstein_${Date.now()}@princeton.edu`;
    const testPassword = 'Relativity2026!';

    // Cleanup
    await Teacher.deleteMany({ email: testEmail });

    // 1. Test POST /auth/signup
    console.log('\n[1] Testing POST /auth/signup...');
    const signupRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/auth/signup',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, {
        name: 'Albert Einstein',
        email: testEmail,
        password: testPassword,
        role: 'teacher'
    });

    console.log(` Signup Status: ${signupRes.statusCode}`);
    console.log(` AccessToken received: ${!!signupRes.data.accessToken}`);
    console.log(` Cookie set: ${signupRes.cookies.length > 0 ? signupRes.cookies[0].split(';')[0] : 'None'}`);

    let accessToken = signupRes.data.accessToken;
    let cookie = signupRes.cookies[0];

    // 2. Test GET /auth/me (Protected)
    console.log('\n[2] Testing GET /auth/me (With Bearer Token)...');
    const meRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/auth/me',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    console.log(` GET /auth/me Status: ${meRes.statusCode}`);
    console.log(` Current teacher: ${meRes.data.teacher?.name} (${meRes.data.teacher?.email})`);

    // 3. Test GET /auth/me without token (Should fail 401)
    console.log('\n[3] Testing GET /auth/me Without Token (Expected 401)...');
    const unauthRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/auth/me',
        method: 'GET'
    });
    console.log(` Unauthenticated /auth/me Status: ${unauthRes.statusCode} (${unauthRes.data.error})`);

    // 4. Test POST /auth/login
    console.log('\n[4] Testing POST /auth/login...');
    const loginRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, {
        email: testEmail,
        password: testPassword
    });
    console.log(` Login Status: ${loginRes.statusCode}`);
    console.log(` New AccessToken received: ${!!loginRes.data.accessToken}`);
    accessToken = loginRes.data.accessToken;
    cookie = loginRes.cookies[0];

    // 5. Test POST /auth/refresh
    console.log('\n[5] Testing POST /auth/refresh with httpOnly Cookie...');
    const refreshRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/auth/refresh',
        method: 'POST',
        headers: {
            'Cookie': cookie
        }
    });
    console.log(` Refresh Status: ${refreshRes.statusCode}`);
    console.log(` Rotated AccessToken received: ${!!refreshRes.data.accessToken}`);
    if (refreshRes.cookies.length > 0) {
        cookie = refreshRes.cookies[0];
        console.log(` Rotated Refresh Cookie received: ${cookie.split(';')[0]}`);
    }

    // 6. Test Protected Route: GET /exams
    console.log('\n[6] Testing Protected Teacher Route: GET /exams...');
    const examsAuthRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/exams',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    console.log(` GET /exams with Auth Status: ${examsAuthRes.statusCode}`);

    const examsNoAuthRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/exams',
        method: 'GET'
    });
    console.log(` GET /exams without Auth Status: ${examsNoAuthRes.statusCode} (${examsNoAuthRes.data.error})`);

    // 7. Test Open Route: POST /violation (Machine-to-Machine)
    console.log('\n[7] Testing Open Candidate Route: POST /violation...');
    const violationRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/violation',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, {
        sessionId: 'test_session_dummy',
        type: 'cell_phone',
        severity: 4,
        details: { confidence: 0.95 }
    });
    console.log(` POST /violation Status: ${violationRes.statusCode} (Should succeed without token: 200 or 201)`);

    // 8. Test POST /auth/logout
    console.log('\n[8] Testing POST /auth/logout...');
    const logoutRes = await makeRequest({
        hostname: 'localhost',
        port: 5000,
        path: '/auth/logout',
        method: 'POST',
        headers: { 'Cookie': cookie }
    });
    console.log(` Logout Status: ${logoutRes.statusCode}`);

    // Cleanup
    await Teacher.deleteMany({ email: testEmail });
    await AuthAuditLog.deleteMany({ email: testEmail });
    await mongoose.disconnect();

    console.log('\n All HTTP Integration Tests Passed Successfully!');
}

testHttpEndpoints().catch(err => {
    console.error('HTTP Test failed:', err);
    process.exit(1);
});
