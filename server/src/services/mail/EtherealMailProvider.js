const nodemailer = require('nodemailer');
const MailProvider = require('./MailProvider');

class EtherealMailProvider extends MailProvider {
    constructor() {
        super();
        this.transporter = null;
        this.initPromise = null;
    }

    /**
     * Initializes or retrieves the cached Ethereal test transporter
     */
    async _getTransporter() {
        if (this.transporter) {
            return this.transporter;
        }

        if (!this.initPromise) {
            this.initPromise = (async () => {
                const testAccount = await nodemailer.createTestAccount();
                this.transporter = nodemailer.createTransport({
                    host: testAccount.smtp.host,
                    port: testAccount.smtp.port,
                    secure: testAccount.smtp.secure,
                    auth: {
                        user: testAccount.user,
                        pass: testAccount.pass
                    }
                });
                console.log(`[MAIL] Ethereal test mailer initialized as: ${testAccount.user}`);
                return this.transporter;
            })();
        }

        return this.initPromise;
    }

    /**
     * Send an email via Ethereal and return preview URL
     */
    async send({ to, subject, html, text }) {
        try {
            const transporter = await this._getTransporter();
            const info = await transporter.sendMail({
                from: '"IntegrityFlow Security" <security@integrityflow.local>',
                to,
                subject,
                text: text || html.replace(/<[^>]*>?/gm, ''),
                html
            });

            const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
            if (previewUrl) {
                console.log(`[MAIL] Ethereal Email Preview: ${previewUrl}`);
            }

            return {
                success: true,
                messageId: info.messageId,
                previewUrl
            };
        } catch (err) {
            console.error('[MAIL] Failed to send email via Ethereal:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }
}

module.exports = EtherealMailProvider;
