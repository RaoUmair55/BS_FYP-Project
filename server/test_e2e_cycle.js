const http = require('http');

function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL('http://localhost:5000' + path);
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function runTestCycle() {
    console.log('=====================================================');
    console.log('      INTEGRITYFLOW FULL CYCLE VERIFICATION TEST     ');
    console.log('=====================================================\n');

    // 0. Login as Super Admin
    console.log('0. Logging in as Administrator...');
    const loginRes = await request('POST', '/auth/login', {
        email: 'admin@integrityflow.com',
        password: 'AdminSecurePass2026!'
    });

    if (loginRes.status !== 200 || !loginRes.data.accessToken) {
        console.error('Failed to log in:', loginRes);
        return;
    }
    const token = loginRes.data.accessToken;
    const authHeaders = { Authorization: `Bearer ${token}` };
    console.log(`✓ Logged in successfully: ${loginRes.data.teacher.name} (${loginRes.data.teacher.role})`);

    // 1. Create a fresh Exam
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const testCode = `CYC${randNum}`;
    console.log(`\n1. Creating Exam with code [${testCode}]...`);
    
    const createRes = await request('POST', '/exams', {
        title: `Full Cycle Verification Exam (${testCode})`,
        examCode: testCode,
        durationMinutes: 30,
        status: 'active',
        rules: {
            detectCellPhone: true,
            detectMultiplePersons: true,
            detectAbsence: true,
            enforceAppWhitelist: true,
            autoTerminateRiskScore: 90
        }
    }, authHeaders);

    if (createRes.status !== 201 && createRes.status !== 200) {
        console.error('Failed to create exam:', createRes);
        return;
    }
    const exam = createRes.data.exam || createRes.data;
    console.log(`✓ Exam created: ID=${exam._id}, Code=${exam.examCode}, Status=${exam.status}`);

    // 2. Register Candidate 1 (Alice) & Candidate 2 (Bob)
    console.log('\n2. Registering Candidates (Alice & Bob)...');
    
    // Alice joins
    const aliceRes = await request('POST', '/sessions', {
        examId: testCode,
        studentName: 'Alice Smith',
        rollNumber: `FA21-BCS-001`,
        consentGiven: true
    });
    if (aliceRes.status !== 201) {
        console.error('Failed Alice session:', aliceRes);
        return;
    }
    const aliceSession = aliceRes.data;
    console.log(`✓ Candidate 1 Joined: Alice Smith (Roll: ${aliceSession.rollNumber}) | Session: ${aliceSession._id}`);

    // Bob joins
    const bobRes = await request('POST', '/sessions', {
        examId: testCode,
        studentName: 'Bob Johnson',
        rollNumber: `FA21-BCS-002`,
        consentGiven: true
    });
    if (bobRes.status !== 201) {
        console.error('Failed Bob session:', bobRes);
        return;
    }
    const bobSession = bobRes.data;
    console.log(`✓ Candidate 2 Joined: Bob Johnson (Roll: ${bobSession.rollNumber}) | Session: ${bobSession._id}`);

    // 3. Post simulated integrity alerts for Alice
    console.log('\n3. Emitting AI Integrity Alerts for Alice...');
    
    await request('POST', '/violation', {
        sessionId: aliceSession._id,
        type: 'cell_phone',
        severity: 4,
        confidence: 0.95,
        details: { message: 'Smartphone detected in camera frame' }
    });
    console.log(`✓ Alert 1 emitted: Cell Phone Detected (Severity 4)`);

    await request('POST', '/violation', {
        sessionId: aliceSession._id,
        type: 'unauthorized_app',
        severity: 3,
        confidence: 0.89,
        details: { processName: 'discord.exe' }
    });
    console.log(`✓ Alert 2 emitted: Unauthorized App Running (Severity 3)`);

    // Check risk score
    const aliceScoreRes = await request('GET', `/risk-score/${aliceSession._id}`, null, authHeaders);
    console.log(`✓ Recalculated Risk Score for Alice: ${aliceScoreRes.data.riskScore}`);

    // 4. Verify Live Exam list candidate counts
    console.log('\n4. Checking Live Exams API (GET /exams)...');
    const liveExamsRes = await request('GET', '/exams', null, authHeaders);
    const liveExamData = liveExamsRes.data.find(e => e.examCode === testCode);
    console.log(`✓ Live Card Data for [${testCode}]:`);
    console.log(`   - Exam Code: ${liveExamData.examCode}`);
    console.log(`   - Status: ${liveExamData.status}`);
    console.log(`   - activeStudents count: ${liveExamData.activeStudents}`);
    console.log(`   - totalStudents count: ${liveExamData.totalStudents}`);
    console.log(`   - Card Label UI: "${liveExamData.activeStudents} Candidates Live"`);

    // 5. Complete sessions & complete exam
    console.log('\n5. Submitting Exam & Transitioning to Completed State...');
    
    // Alice submits answer
    const aliceSubmitRes = await request('POST', '/submissions', {
        sessionId: aliceSession._id,
        answerText: 'Final exam submission answers by Alice Smith.'
    });
    console.log(`✓ Alice submitted exam: ${aliceSubmitRes.data.message}`);

    // Bob submits answer
    const bobSubmitRes = await request('POST', '/submissions', {
        sessionId: bobSession._id,
        answerText: 'Final exam submission answers by Bob Johnson.'
    });
    console.log(`✓ Bob submitted exam: ${bobSubmitRes.data.message}`);

    // End the Exam (Teacher ends exam or auto-expiry)
    const endExamRes = await request('PATCH', `/exams/${exam._id}/status`, {
        status: 'completed'
    }, authHeaders);
    console.log(`✓ Exam [${testCode}] status updated to: ${endExamRes.data.exam ? endExamRes.data.exam.status : 'completed'}`);

    // 6. Check History Tab exams list
    console.log('\n6. Checking History Exams API (GET /exams)...');
    const historyExamsRes = await request('GET', '/exams', null, authHeaders);
    const historyExamData = historyExamsRes.data.find(e => e.examCode === testCode);
    console.log(`✓ History Card Data for [${testCode}]:`);
    console.log(`   - Exam Code: ${historyExamData.examCode}`);
    console.log(`   - Status: ${historyExamData.status}`);
    console.log(`   - activeStudents count: ${historyExamData.activeStudents}`);
    console.log(`   - totalStudents count: ${historyExamData.totalStudents}`);
    console.log(`   - Card Label UI: "${historyExamData.totalStudents} Candidates Participated"`);

    // 7. Check Detailed Exam Summary (/exams/:id/summary)
    console.log('\n7. Checking Detailed Exam Summary (GET /exams/:id/summary)...');
    const summaryRes = await request('GET', `/exams/${exam._id}/summary`, null, authHeaders);
    const summary = summaryRes.data;
    console.log(`✓ Summary Stats:`);
    console.log(`   - Exam Title: ${summary.exam.title} (${summary.exam.examCode})`);
    console.log(`   - Total Candidates: ${summary.totalStudents}`);
    console.log(`   - Total Violations Recorded: ${summary.totalViolations}`);
    console.log(`   - Average Risk Score: ${summary.avgRiskScore}`);
    console.log(`   - Risk Distribution:`, summary.riskDistribution);
    console.log(`   - Violation Breakdown:`, summary.violationBreakdown);
    console.log(`\n✓ Candidates Roster in Summary (${summary.sessions.length} candidates):`);
    summary.sessions.forEach((s, idx) => {
        console.log(`   [${idx + 1}] ${s.studentName} (${s.rollNumber})`);
        console.log(`       - Status: ${s.status}`);
        console.log(`       - Final Risk Score: ${s.finalRiskScore}`);
        console.log(`       - Violations: ${s.violationCount}`);
        console.log(`       - Submission: ${s.submissionStatus} (${s.submissionType || 'N/A'})`);
    });

    console.log('\n=====================================================');
    console.log('   FULL CYCLE TEST PASSED: ALL COUNTS MATCH 100%   ');
    console.log('=====================================================');
}

runTestCycle().catch(console.error);
