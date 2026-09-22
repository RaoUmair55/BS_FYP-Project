const bcrypt = require('bcrypt');
const Teacher = require('../models/Teacher');

/**
 * Seeds or updates the initial Super Administrator from environment variables.
 * Safe to run on every startup (idempotent).
 */
async function seedAdmin() {
    try {
        const adminEmail = (process.env.ADMIN_EMAIL || 'admin@integrityflow.com').toLowerCase().trim();
        const adminPassword = process.env.ADMIN_PASSWORD || 'AdminSecurePass2026!';
        const adminName = process.env.ADMIN_NAME || 'System Administrator';

        let adminUser = await Teacher.findOne({ email: adminEmail });

        if (!adminUser) {
            const passwordHash = await bcrypt.hash(adminPassword, 12);
            adminUser = new Teacher({
                name: adminName,
                email: adminEmail,
                passwordHash,
                role: 'admin',
                emailVerified: true
            });
            await adminUser.save();
            console.log(`[BootstrapAdmin] Created initial Super Administrator: ${adminEmail}`);
        } else {
            if (adminUser.role !== 'admin') {
                adminUser.role = 'admin';
                await adminUser.save();
                console.log(`[BootstrapAdmin] Promoted existing account ${adminEmail} to admin role.`);
            }
        }
    } catch (err) {
        console.error('[BootstrapAdmin] Failed to seed initial admin user:', err.message);
    }
}

module.exports = seedAdmin;
