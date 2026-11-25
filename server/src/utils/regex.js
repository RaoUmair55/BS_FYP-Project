/**
 * Escapes special regular-expression characters so user/database strings are
 * always matched literally in MongoDB $regex / RegExp queries.
 */
function escapeRegex(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactCaseInsensitiveRegex(value) {
    return new RegExp('^' + escapeRegex(value) + '$', 'i');
}

module.exports = {
    escapeRegex,
    exactCaseInsensitiveRegex
};
