const { v2: cloudinary } = require('cloudinary');
const StorageProvider = require('./StorageProvider');
const path = require('path');

/**
 * Cloudinary Storage Provider
 * Implements StorageProvider for uploading and managing assets on Cloudinary CDN.
 */
class CloudinaryStorageProvider extends StorageProvider {
    constructor(config = {}) {
        super();
        this.cloudName = config.cloudName || process.env.CLOUDINARY_CLOUD_NAME;
        this.apiKey = config.apiKey || process.env.CLOUDINARY_API_KEY;
        this.apiSecret = config.apiSecret || process.env.CLOUDINARY_API_SECRET;

        cloudinary.config({
            cloud_name: this.cloudName,
            api_key: this.apiKey,
            api_secret: this.apiSecret,
            secure: true
        });

        console.log(`[CloudinaryStorageProvider] Initialized for cloud: ${this.cloudName}`);
    }

    /**
     * Save a file buffer, base64 string, or stream to Cloudinary
     * @param {Buffer|string} fileBuffer - Buffer or base64 / data URL string
     * @param {string} filename - Filename identifier
     * @param {string} folder - Target folder (e.g., 'screenshots', 'papers', 'verification', 'submissions')
     * @returns {Promise<{ path: string, url: string, public_id: string, size?: number }>}
     */
    async save(fileBuffer, filename, folder = 'general') {
        const folderPath = `integrityflow/${folder}`;
        const baseName = path.parse(filename).name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const publicId = `${baseName}_${Date.now()}`;

        return new Promise((resolve, reject) => {
            const uploadOptions = {
                folder: folderPath,
                public_id: publicId,
                resource_type: 'auto', // Handles images (jpg, png) and raw files (pdf, docx) automatically
                overwrite: true
            };

            // 1. If buffer is provided
            if (Buffer.isBuffer(fileBuffer)) {
                const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
                    if (error) {
                        console.error('[CloudinaryStorageProvider] Upload buffer error:', error);
                        return reject(error);
                    }
                    resolve({
                        path: result.secure_url,
                        url: result.secure_url,
                        public_id: result.public_id,
                        size: result.bytes,
                        format: result.format
                    });
                });
                uploadStream.end(fileBuffer);
            } 
            // 2. If string is provided (base64, data URI, or URL/path)
            else if (typeof fileBuffer === 'string') {
                let dataToUpload = fileBuffer;
                // If it's a raw base64 without data URI prefix, format as data URI
                if (!dataToUpload.startsWith('data:') && !dataToUpload.startsWith('http')) {
                    dataToUpload = `data:image/jpeg;base64,${dataToUpload}`;
                }

                cloudinary.uploader.upload(dataToUpload, uploadOptions, (error, result) => {
                    if (error) {
                        console.error('[CloudinaryStorageProvider] Upload string error:', error);
                        return reject(error);
                    }
                    resolve({
                        path: result.secure_url,
                        url: result.secure_url,
                        public_id: result.public_id,
                        size: result.bytes,
                        format: result.format
                    });
                });
            } else {
                reject(new Error('[CloudinaryStorageProvider] Invalid fileBuffer type. Expected Buffer or string.'));
            }
        });
    }

    /**
     * Get accessible URL for a stored file
     */
    async getUrl(filePath) {
        if (!filePath) return '';
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            return filePath;
        }
        return cloudinary.url(filePath, { secure: true });
    }

    /**
     * Delete a stored file from Cloudinary
     */
    async delete(filePath) {
        if (!filePath) return false;
        try {
            const publicId = this._extractPublicId(filePath);
            if (!publicId) return false;

            // Try image resource type first
            let result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
            if (result.result !== 'ok') {
                // Try raw resource type (for PDFs, docs)
                result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
            }
            return result.result === 'ok';
        } catch (err) {
            console.error('[CloudinaryStorageProvider] Delete error:', err);
            return false;
        }
    }

    /**
     * Check if a file exists (if full URL provided, returns true)
     */
    async exists(filePath) {
        if (!filePath) return false;
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            return true;
        }
        try {
            const publicId = this._extractPublicId(filePath);
            const res = await cloudinary.api.resource(publicId);
            return Boolean(res);
        } catch (err) {
            return false;
        }
    }

    /**
     * For Cloudinary, absolute path is the remote CDN URL
     */
    getAbsolutePath(filePath) {
        return filePath || '';
    }

    /**
     * Helper to extract public_id from Cloudinary URL or path
     * @private
     */
    _extractPublicId(filePath) {
        if (!filePath) return null;
        if (!filePath.startsWith('http://') && !filePath.startsWith('https://')) {
            return filePath;
        }
        try {
            // URL format: https://res.cloudinary.com/<cloud_name>/<resource_type>/upload/v<version>/<public_id>.<ext>
            const parts = filePath.split('/upload/');
            if (parts.length > 1) {
                const afterUpload = parts[1];
                // Strip optional version prefix v12345678/
                const withoutVersion = afterUpload.replace(/^v\d+\//, '');
                // Strip extension
                return withoutVersion.replace(/\.[^/.]+$/, '');
            }
            return null;
        } catch (e) {
            return null;
        }
    }
}

module.exports = CloudinaryStorageProvider;
