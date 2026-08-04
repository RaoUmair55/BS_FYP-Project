const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:5000';
console.log(`Connecting to ${SERVER_URL}...`);

const socket = io(SERVER_URL);

socket.on('connect', () => {
    console.log('Connected to server successfully with ID:', socket.id);
    console.log('Waiting for violation events...');
});

socket.on('violation', (data) => {
    console.log('\n--- NEW VIOLATION RECEIVED ---');
    console.log(JSON.stringify(data, null, 2));
});

socket.on('disconnect', () => {
    console.log('Disconnected from server.');
});

socket.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
});
