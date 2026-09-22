require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const storageService = require('../src/services/storage');

async function testCloudinary() {
    console.log('Testing Cloudinary Storage Provider Integration...');
    
    // Create a 1x1 transparent PNG buffer
    const testBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
    );

    try {
        console.log('1. Uploading test buffer...');
        const result = await storageService.save(testBuffer, 'test_integrity_ping.png', 'test');
        console.log(' Upload successful!');
        console.log('   Result:', result);

        if (!result.url || !result.url.startsWith('http')) {
            throw new Error(`Invalid URL returned: ${result.url}`);
        }

        console.log('2. Testing exists...');
        const exists = await storageService.exists(result.path);
        console.log(' Exists check:', exists);

        console.log('3. Testing delete...');
        const deleted = await storageService.delete(result.path);
        console.log(' Delete result:', deleted);

        console.log('\n All Cloudinary tests passed successfully!');
    } catch (err) {
        console.error('❌ Cloudinary test failed:', err);
        process.exit(1);
    }
}

testCloudinary();
