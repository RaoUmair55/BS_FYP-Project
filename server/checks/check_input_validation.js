// Regression checks: invalid inputs stop before network/registration and valid identities remain accepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { nameSchema, rollNumberSchema, examCodeSchema, emailSchema, passwordSchema } = require('../src/utils/inputValidation');

async function main() {
    const frontend = await import('../../dashboard/src/utils/inputValidation.js');
    for (const name of ['Rao Umair Ahmed', "O'Connor", 'Anne-Marie', 'محمد عثمان', 'José García']) {
        assert(nameSchema.safeParse(name).success, name);
        assert(frontend.validName(name), name);
        assert(new RegExp(`^(?:${frontend.NAME_PATTERN})$`, 'v').test(name), name);
    }
    for (const name of ['', '   ', '12345', '<script>', '--', 'A', 'A'.repeat(101)]) {
        assert(!nameSchema.safeParse(name).success, name);
        assert(!frontend.validName(name), name);
    }
    for (const roll of ['233163', 'FA20-BCS-042', 'BSCS/01', 'CS_01.2']) assert(rollNumberSchema.safeParse(roll).success);
    for (const roll of ['', '--', ' / ', '<student>', '1', '1'.repeat(36), {}]) assert(!rollNumberSchema.safeParse(roll).success);
    assert.equal(examCodeSchema.parse(' exam-101 '), 'EXAM-101');
    for (const code of ['', '--', '---', 'EXAM 101', '<EXAM>', 'X'.repeat(33), {}]) assert(!examCodeSchema.safeParse(code).success);
    for (const email of ['teacher@university.edu', ' Teacher@Example.com ']) {
        assert(emailSchema.safeParse(email).success); assert(frontend.validEmail(email));
    }
    for (const email of ['', 'teacher', 'a@@example.com', 'a@', 'a b@example.com']) {
        assert(!emailSchema.safeParse(email).success); assert(!frontend.validEmail(email));
    }
    assert(passwordSchema.safeParse('Password1').success);
    assert(!passwordSchema.safeParse('short1').success);
    assert(!passwordSchema.safeParse('password').success);
    const oversized = 'é'.repeat(36) + '1';
    assert(!passwordSchema.safeParse(oversized).success);
    assert(!frontend.validPasswordSize(oversized));

    const source = fs.readFileSync(path.join(__dirname, '..', '../candidate-app/renderer/identity.js'), 'utf8');
    for (const [name, roll, expected] of [['12345','233163',0], ['--','233163',0], ['Umair','---',0], ['محمد عثمان','233163',1], ['Rao Umair Ahmed','FA20-BCS-042',1]]) {
        let ready, calls = 0;
        const elements = new Map();
        const element = id => {
            if (!elements.has(id)) elements.set(id, {value:'',style:{},listeners:{},focus(){},setAttribute(){},
                addEventListener(event, fn){this.listeners[event]=fn;}});
            return elements.get(id);
        };
        vm.runInNewContext(source, {
            document:{getElementById:element,addEventListener:(event,fn)=>{ready=fn;}},
            window:{api:{getSessionInfo:async()=>({consentGiven:true,studentName:name,rollNumber:roll,examId:'EXAM-101'}),proceedToSelfCheck:async()=>{}}},
            sessionStorage:{getItem:()=> '{}',setItem(){}},localStorage:{setItem(){}},
            fetch:async()=>{calls++;return {ok:true,json:async()=>({_id:'test-session'})};},
            console:{log(){},warn(){},error(){}},Date,AbortSignal
        });
        await ready();
        await element('btnSubmitIdentity').listeners.click();
        assert.equal(calls,expected,`${name}/${roll}`);
        if (expected) { await element('btnSubmitIdentity').listeners.click(); assert.equal(calls,1,'duplicate submission prevented'); }
    }
    const login = fs.readFileSync(path.join(__dirname, '..', '../candidate-app/renderer/login.js'),'utf8');
    for (const code of ['', '---', 'EXAM 101', 'X'.repeat(33)]) {
        let calls=0;
        const fields = {examId:{value:code,focus(){},setAttribute(){},addEventListener(){}},loginBtn:{addEventListener(){}},errorMsg:{}};
        const context=vm.createContext({document:{getElementById:id=>fields[id]},fetch:()=>{calls++;},console});
        vm.runInContext(login,context);
        await vm.runInContext('handleLogin()',context);
        assert.equal(calls,0,'malformed exam code must not reach server');
        assert(fields.errorMsg.textContent);
    }
    console.log('PASS: input schemas, international names, frontend rules, candidate rejection before requests and duplicate-submit protection');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
