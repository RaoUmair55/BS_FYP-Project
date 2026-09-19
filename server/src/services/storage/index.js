const LocalStorageProvider = require('./LocalStorageProvider');

// -----------------------------------------------------------------------------
// Active Storage Provider
// -----------------------------------------------------------------------------
// To swap to a cloud storage provider (e.g. AWS S3, Cloudinary, Azure Blob):
// 1. Create S3StorageProvider.js implementing StorageProvider.js
// 2. Change the instantiated instance below:
//    const storageService = new S3StorageProvider({ bucket: process.env.S3_BUCKET });
// -----------------------------------------------------------------------------
const storageService = new LocalStorageProvider();

module.exports = storageService;
