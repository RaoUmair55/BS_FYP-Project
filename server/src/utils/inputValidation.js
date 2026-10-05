const { z } = require('zod');

// Allow international names without accepting markup, digits or punctuation-only names.
const nameSchema = z.string().trim().min(2, 'Name must contain 2-100 characters')
    .max(100, 'Name must contain 2-100 characters')
    .regex(/^[\p{L}\p{M} .'\u2019-]+$/u, 'Name may contain letters, spaces, apostrophes, periods and hyphens')
    .refine(value => (value.match(/\p{L}/gu) || []).length >= 2, 'Name must contain at least two letters');
const examCodeSchema = z.string().trim().min(3).max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'Exam code must contain 3-32 letters, numbers or hyphens')
    .refine(value => /[A-Za-z0-9]/.test(value), 'Exam code must contain a letter or number')
    .transform(value => value.toUpperCase());
const rollNumberSchema = z.string().trim().min(2).max(35)
    .regex(/^[A-Za-z0-9_/. -]+$/, 'Roll number must contain 2-35 letters, numbers, spaces, hyphens, underscores, periods or slashes')
    .refine(value => /[A-Za-z0-9]/.test(value), 'Roll number must contain a letter or number');
const emailSchema = z.string().trim().max(254, 'Email must be no longer than 254 characters')
    .email('Enter a valid email address').toLowerCase();
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters long')
    .regex(/\d/, 'Password must contain at least one number')
    .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be no longer than 72 UTF-8 bytes');

module.exports = { nameSchema, examCodeSchema, rollNumberSchema, emailSchema, passwordSchema };
