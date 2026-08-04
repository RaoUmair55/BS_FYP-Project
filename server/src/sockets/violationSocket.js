module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log('Client connected');
        // broadcast violation event when saved
    });
};
