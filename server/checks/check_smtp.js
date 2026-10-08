const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
let options, sent;
nodemailer.createTransport = config => {options=config;return {sendMail:async message => {sent=message;return {accepted:[message.to],messageId:'test'};}};};
process.env.SMTP_HOST='smtp.example.test';process.env.SMTP_PORT='587';process.env.SMTP_SECURE='false';
process.env.SMTP_USER='sender@example.test';process.env.SMTP_PASSWORD='test-only';process.env.MAIL_FROM='sender@example.test';
const SMTP = require('../src/services/mail/SMTPMailProvider');
(async()=>{
 const mail=new SMTP();
 assert.equal(options.port,587);assert.equal(options.secure,false);assert.equal(options.requireTLS,true);
 let result=await mail.send({to:'recipient@example.test',subject:'Test',html:'<p>Hello</p>'});
 assert.equal(result.success,true);assert.equal(sent.from,process.env.MAIL_FROM);assert.equal(sent.text,'Hello');
 mail.transporter.sendMail=async()=>({accepted:[],rejected:['recipient@example.test']});
 assert.equal((await mail.send({to:'recipient@example.test',subject:'Test',html:'Hello'})).success,false);
 mail.transporter.sendMail=async()=>{throw new Error('Unavailable');};
 assert.equal((await mail.send({to:'recipient@example.test',subject:'Test',html:'Hello'})).success,false);
 console.log('PASS: SMTP TLS configuration, sender, successful delivery acknowledgement, rejected recipient and network errors. No network or email used.');
})().catch(err=>{console.error(err);process.exitCode=1;});
