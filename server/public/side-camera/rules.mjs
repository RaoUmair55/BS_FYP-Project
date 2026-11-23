export function angleDistance(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
export function orientationDistance(a, b) { return Math.max(...['alpha', 'beta', 'gamma'].map(k => angleDistance(a[k], b[k]))); }
export function tiltDistance(a, b) { return Math.max(angleDistance(a.beta, b.beta), angleDistance(a.gamma, b.gamma)); }

const detectionCategory = d => d?.categories?.[0]?.categoryName?.toLowerCase() || '';
const detectionScore = d => Number(d?.categories?.[0]?.score ?? 0);

export const SETUP_WORKSTATION_LABELS = ['laptop', 'keyboard', 'mouse', 'tv'];

export function evaluatePersonFraming(detections, width, height) {
    const persons = (Array.isArray(detections) ? detections : []).filter(d => detectionCategory(d) === 'person' && d?.boundingBox);
    if (!persons.length || !width || !height) return { ok: false, reason: 'missing', box: null };

    // Evaluate the largest foreground person in the frame.
    const best = persons.reduce((a, b) => (b.boundingBox.width * b.boundingBox.height > a.boundingBox.width * a.boundingBox.height ? b : a));
    const b = best.boundingBox;
    const coversWholeFrame = b.width >= width * 0.95 && b.height >= height * 0.95;
    if (coversWholeFrame) return { ok: false, reason: 'too_close', box: b };
    if (b.width < width * 0.14 || b.height < height * 0.32) return { ok: false, reason: 'too_small', box: b };
    // Head must remain inside the top edge (>= 2% headroom); seated lower body & back shoulder may touch bottom/side edges.
    if (b.originY < height * 0.02) return { ok: false, reason: 'head_clipped', box: b };
    return { ok: true, reason: 'ok', box: b };
}

export function placementCriteria(detections, width, height, luminance, orientation, steady, minimumLight = 35) {
    return {
        person: evaluatePersonFraming(detections, width, height).ok,
        workstation: detections.some(d => SETUP_WORKSTATION_LABELS.includes(detectionCategory(d))),
        lighting: luminance > minimumLight,
        steady: Boolean(orientation && steady)
    };
}

/**
 * Pure Part-2 desk-side monitoring analyzer (runs lazily every ~3s on the phone).
 * Uses stricter confidence (minConfidence=0.52) for violation objects so setup can
 * remain forgiving without causing false exam alerts.
 */
export function analyzeDeskFrame(detections, width, height, minConfidence = 0.52) {
    const list = Array.isArray(detections) ? detections : [];
    const foregroundPersons = list.filter(d => {
        if (detectionCategory(d) !== 'person') return false;
        if (d?.categories?.[0]?.score !== undefined && detectionScore(d) < 0.45) return false;
        const b = d.boundingBox;
        if (!b || !width || !height) return true;
        return b.width >= width * 0.08 && b.height >= height * 0.18;
    });

    const byLabel = label => list.filter(d =>
        detectionCategory(d) === label &&
        (d?.categories?.[0]?.score === undefined || detectionScore(d) >= minConfidence)
    );

    const laptops = byLabel('laptop');
    const phones = byLabel('cell phone');
    const books = byLabel('book');
    const extraDisplays = byLabel('tv');
    const workstationVisible = list.some(d => SETUP_WORKSTATION_LABELS.includes(detectionCategory(d)));

    const candidates = [];
    if (phones.length > 0) {
        const best = phones.reduce((a, b) => (detectionScore(b) > detectionScore(a) ? b : a));
        candidates.push({ type: 'cell_phone', objectClass: 'cell phone', confidence: detectionScore(best), severity: 4 });
    }
    if (books.length > 0) {
        const best = books.reduce((a, b) => (detectionScore(b) > detectionScore(a) ? b : a));
        candidates.push({ type: 'unauthorized_object', objectClass: 'book', confidence: detectionScore(best), severity: 4 });
    }
    if (extraDisplays.length > 0 || laptops.length >= 2) {
        const pool = extraDisplays.length > 0 ? extraDisplays : laptops;
        const best = pool.reduce((a, b) => (detectionScore(b) > detectionScore(a) ? b : a));
        candidates.push({
            type: 'unauthorized_object',
            objectClass: extraDisplays.length > 0 ? 'secondary monitor / tv' : 'second laptop',
            confidence: detectionScore(best),
            severity: 4
        });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return {
        personCount: foregroundPersons.length,
        secondPerson: foregroundPersons.length >= 2,
        personAbsent: foregroundPersons.length === 0,
        workstationVisible,
        unauthorizedObject: candidates[0] || null
    };
}
