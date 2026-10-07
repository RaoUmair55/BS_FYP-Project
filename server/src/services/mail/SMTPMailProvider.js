const nodemailer = require('nodemailer');
const MailProvider = require('./MailProvider');

class SMTPMailProvider extends MailProvider {
    constructor() {
        super();
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === 'true',
            requireTLS: process.env.SMTP_SECURE !== 'true',
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
        });
    }
    async send({ to, subject, html, text }) {
        try {
            if (!process.env.MAIL_FROM) throw new Error('MAIL_FROM is required for SMTP delivery');
            const result = await this.transporter.sendMail({ from: process.env.MAIL_FROM, to, subject, html, text: text || html.replace(/<[^>]*>/g, '') });
            if (!result.accepted?.length) throw new Error('SMTP server did not accept the recipient');
            return { success: true, messageId: result.messageId };
        } catch (err) { return { success: false, error: err.message }; }
    }
}
module.exports = SMTPMailProvider;
