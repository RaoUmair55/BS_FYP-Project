const EtherealMailProvider = require('./EtherealMailProvider');

// -----------------------------------------------------------------------------
// Active Mail Provider
// -----------------------------------------------------------------------------
// To swap to a production mail provider (e.g. SendGrid, Resend, AWS SES):
// 1. Create SendGridMailProvider.js or ResendMailProvider.js implementing MailProvider.js
// 2. Change the instantiated instance below:
//    const mailService = new SendGridMailProvider({ apiKey: process.env.SENDGRID_API_KEY });
// -----------------------------------------------------------------------------
const mailService = new EtherealMailProvider();

module.exports = mailService;
