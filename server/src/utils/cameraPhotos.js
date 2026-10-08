const { randomUUID } = require('node:crypto');

function createPhotoSchedule(start, end, random = Math.random) {
    if (!Number.isFinite(end) || end <= start) return [];
    const interval = (end - start) / 3;
    return [0, 1, 2].map(index => ({ id: randomUUID(), source: 'scheduled',
        dueAt: new Date(start + interval * (index + .2 + random() * .6)), note: '' }));
}
function nextPhotoRequest(requests = [], now) {
    return requests.filter(r => !r.completedAt && new Date(r.dueAt).getTime() <= now)
        .sort((a, b) => (a.source === 'requested' ? 0 : 1) - (b.source === 'requested' ? 0 : 1) || new Date(a.dueAt) - new Date(b.dueAt))[0] || null;
}
module.exports = { createPhotoSchedule, nextPhotoRequest };

module.exports.photoUrls = session => [...new Set([session.cameraVerificationPhoto, ...(session.cameraPhotos || []).map(photo => photo.url)].filter(Boolean))];
module.exports.deletePhotoHistory = async (session, storage) => {
    for (const url of module.exports.photoUrls(session)) await storage.delete(url);
};
