/**
 * Abstract StorageProvider Interface
 * Any storage implementation (Local, AWS S3, Cloudinary, Azure Blob) must implement this contract.
 */
class StorageProvider {
    /**
     * Save a file buffer to storage
     * @param {Buffer|string} fileBuffer - Buffer or base64 data string
     * @param {string} filename - Target filename with extension
     * @param {string} folder - Destination subfolder (e.g., 'screenshots', 'papers', 'verification', 'submissions')
     * @returns {Promise<{ path: string, url: string, size?: number }>}
     */
    async save(fileBuffer, filename, folder) {
        throw new Error("Method 'save(fileBuffer, filename, folder)' must be implemented by concrete subclass.");
    }

    /**
     * Get accessible URL for a stored file
     * @param {string} filePath - Path or identifier
     * @returns {Promise<string>|string}
     */
    async getUrl(filePath) {
        throw new Error("Method 'getUrl(filePath)' must be implemented by concrete subclass.");
    }

    /**
     * Delete a stored file
     * @param {string} filePath - Path or identifier
     * @returns {Promise<boolean>}
     */
    async delete(filePath) {
        throw new Error("Method 'delete(filePath)' must be implemented by concrete subclass.");
    }

    /**
     * Check if a file exists
     * @param {string} filePath - Path or identifier
     * @returns {Promise<boolean>|boolean}
     */
    async exists(filePath) {
        throw new Error("Method 'exists(filePath)' must be implemented by concrete subclass.");
    }

    /**
     * Get absolute local filesystem path (for streaming/serving locally if needed)
     * @param {string} filePath - Stored path
     * @returns {string}
     */
    getAbsolutePath(filePath) {
        throw new Error("Method 'getAbsolutePath(filePath)' must be implemented by concrete subclass.");
    }
}

module.exports = StorageProvider;
