const LocalStorageProvider = require('./LocalStorageProvider');
const CloudinaryStorageProvider = require('./CloudinaryStorageProvider');

// -----------------------------------------------------------------------------
// Active Storage Provider Factory
// -----------------------------------------------------------------------------
// Automatically chooses Cloudinary when credentials are configured in .env,
// otherwise seamlessly falls back to LocalStorageProvider for offline/dev use.
// -----------------------------------------------------------------------------
let storageService;

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    storageService = new CloudinaryStorageProvider();
} else if (process.env.CLOUDINARY_URL) {
    storageService = new CloudinaryStorageProvider();
} else {
    console.log('[StorageService] Cloudinary credentials not found in env. Falling back to LocalStorageProvider.');
    storageService = new LocalStorageProvider();
}

module.exports = storageService;

