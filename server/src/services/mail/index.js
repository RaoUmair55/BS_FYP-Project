const EtherealMailProvider = require('./EtherealMailProvider');
const SMTPMailProvider = require('./SMTPMailProvider');

// SMTP delivers to real inboxes; without SMTP_HOST use development previews.
const useSMTP = Boolean(process.env.SMTP_HOST?.trim());
console.log(useSMTP ? '[MAIL] SMTP delivery enabled' : '[MAIL] Ethereal preview mode: SMTP_HOST is not configured; emails will not reach inboxes');
module.exports = useSMTP ? new SMTPMailProvider() : new EtherealMailProvider();
