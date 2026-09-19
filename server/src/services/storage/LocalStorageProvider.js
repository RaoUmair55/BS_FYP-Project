const fs = require('fs');
const path = require('path');
const StorageProvider = require('./StorageProvider');

class LocalStorageProvider extends StorageProvider {
    constructor(baseDir) {
        super();
        this.baseDir = baseDir || path.join(__dirname, '../../../uploads');
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    /**
     * Resolves absolute filesystem path for a relative or stored path
     */
    getAbsolutePath(filePath) {
        if (!filePath) return '';
        if (path.isAbsolute(filePath)) return filePath;
        
        // Remove leading slash or /uploads/ prefix
        const cleanPath = filePath.replace(/^\/?(uploads\/)?/, '');
        return path.join(this.baseDir, cleanPath);
    }

    /**
     * Save a file buffer to local uploads directory
     */
    async save(fileBuffer, filename, folder = 'general') {
        const targetDir = path.join(this.baseDir, folder);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const absolutePath = path.join(targetDir, filename);
        let buffer;
        if (Buffer.isBuffer(fileBuffer)) {
            buffer = fileBuffer;
        } else if (typeof fileBuffer === 'string') {
            // Handle base64 string or plain text
            if (fileBuffer.startsWith('data:') || /^[A-Za-z0-9+/=]+$/.test(fileBuffer.substring(0, 100))) {
                const base64Clean = fileBuffer.replace(/^data:[^;]+;base64,/, '');
                buffer = Buffer.from(base64Clean, 'base64');
            } else {
                buffer = Buffer.from(fileBuffer, 'utf8');
            }
        } else {
            throw new Error('Invalid fileBuffer type. Expected Buffer or string.');
        }

        fs.writeFileSync(absolutePath, buffer);
        const url = `/uploads/${folder}/${filename}`;

        return {
            path: absolutePath,
            url,
            size: buffer.length
        };
    }

    /**
     * Get URL for accessing the file over HTTP
     */
    async getUrl(filePath) {
        if (!filePath) return '';
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            return filePath;
        }
        if (filePath.startsWith('/uploads/')) {
            return filePath;
        }
        
        const relativeToUploads = path.relative(this.baseDir, this.getAbsolutePath(filePath));
        const normalized = relativeToUploads.split(path.sep).join('/');
        return `/uploads/${normalized}`;
    }

    /**
     * Delete a stored file from disk
     */
    async delete(filePath) {
        try {
            const absolutePath = this.getAbsolutePath(filePath);
            if (fs.existsSync(absolutePath)) {
                fs.unlinkSync(absolutePath);
                return true;
            }
            return false;
        } catch (err) {
            console.error('[LocalStorageProvider] Delete error:', err);
            return false;
        }
    }

    /**
     * Check if a file exists on disk
     */
    async exists(filePath) {
        try {
            const absolutePath = this.getAbsolutePath(filePath);
            return fs.existsSync(absolutePath);
        } catch (err) {
            return false;
        }
    }
}

module.exports = LocalStorageProvider;
