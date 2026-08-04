const { Server } = require('socket.io');

function initSocket(server) {
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
    
    const io = new Server(server, {
        cors: {
            origin: dashboardUrl,
            methods: ["GET", "POST"]
        }
    });

    let connectedClients = 0;

    io.on('connection', (socket) => {
        connectedClients++;
        console.log(`Dashboard client connected. Connected clients: ${connectedClients}`);

        socket.on('disconnect', () => {
            connectedClients--;
            console.log(`Dashboard client disconnected. Connected clients: ${connectedClients}`);
        });
    });

    return io;
}

function broadcastViolation(io, violationDoc) {
    if (io) {
        io.emit('violation', violationDoc);
    }
}

function broadcastRiskScoreUpdate(io, sessionId, riskScore) {
    if (io) {
        io.emit('riskScoreUpdate', { sessionId, riskScore });
    }
}

module.exports = {
    initSocket,
    broadcastViolation,
    broadcastRiskScoreUpdate
};
