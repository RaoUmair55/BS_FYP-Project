export const NAME_PATTERN = "(?=.*\\p{L}.*\\p{L})[\\p{L}\\p{M} .'\u2019\\-]{2,100}";
export function validName(value) {
    const name = value.trim();
    return name.length >= 2 && name.length <= 100 && /^[\p{L}\p{M} .'\u2019-]+$/u.test(name)
        && (name.match(/\p{L}/gu) || []).length >= 2;
}
export function validEmail(value) {
    return value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
export function validPasswordSize(value) {
    return new TextEncoder().encode(value).length <= 72;
}
