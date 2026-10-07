const enabled = () => String(process.env.REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase() === 'true';
module.exports = enabled;
module.exports.needsVerification = teacher => enabled() && teacher.emailVerified !== true;
