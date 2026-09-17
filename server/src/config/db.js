const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of default 30s
        });
        console.log('MongoDB connected successfully');
        
        // Clean up legacy unique index on examId if present
        try {
            await mongoose.connection.collection('exams').dropIndex('examId_1');
            console.log('Dropped legacy index examId_1 from exams collection');
        } catch (e) {
            // Index doesn't exist or already dropped
        }
    } catch (err) {
        console.error('MongoDB connection failed:', err.message);
    }
};

module.exports = connectDB;
