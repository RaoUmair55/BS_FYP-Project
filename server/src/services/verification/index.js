const LinkVerificationStrategy = require('./LinkVerificationStrategy');
const OtpVerificationStrategy = require('./OtpVerificationStrategy');

// -----------------------------------------------------------------------------
// Active Verification Strategy
// -----------------------------------------------------------------------------
// To swap between Link-based verification and OTP 6-digit code verification:
// Default: LinkVerificationStrategy
// For OTP: uncomment the OtpVerificationStrategy line below and comment Link
// -----------------------------------------------------------------------------
const verificationStrategy = new LinkVerificationStrategy();
// const verificationStrategy = new OtpVerificationStrategy();

module.exports = verificationStrategy;
