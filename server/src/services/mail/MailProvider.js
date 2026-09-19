/**
 * Abstract MailProvider Interface
 * Any email provider (Ethereal, SendGrid, Resend, AWS SES) must implement this interface.
 */
class MailProvider {
    /**
     * Send an email
     * @param {Object} options
     * @param {string} options.to - Recipient email address
     * @param {string} options.subject - Email subject line
     * @param {string} options.html - HTML body content
     * @param {string} [options.text] - Plaintext fallback content
     * @returns {Promise<{ success: boolean, previewUrl?: string, messageId?: string, error?: string }>}
     */
    async send({ to, subject, html, text }) {
        throw new Error("Method 'send({ to, subject, html, text })' must be implemented by concrete subclass.");
    }
}

module.exports = MailProvider;
