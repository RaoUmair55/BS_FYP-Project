const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });
const Session = require('../src/models/Session');

async function seed() {
    try {
        console.log('Connecting to DB:', process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI);
        
        const dummySession = {
            _id: 'dummy-session-123',
            studentId: 'STD-DUMMY',
            examId: 'EXAM-101',
            status: 'active'
        };

        await Session.findByIdAndUpdate('dummy-session-123', dummySession, { upsert: true, new: true });
        
        console.log('Successfully seeded dummy-session-123!');
        process.exit(0);
    } catch (err) {
        console.error('Error seeding DB:', err);
        process.exit(1);
    }
}

seed();
