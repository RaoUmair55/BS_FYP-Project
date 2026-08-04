const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/db');
const { initSocket } = require('./sockets/violationSocket');

const app = express();
const server = http.createServer(app);

// CORS for Express API
app.use(cors());
app.use(express.json());

// Initialize Socket.io
const io = initSocket(server);
app.locals.io = io; // Make io accessible in routes

// Connect to MongoDB (without crashing if it fails)
connectDB();

// Mount Routes
app.use('/', require('./routes/violations'));
app.use('/sessions', require('./routes/sessions'));
app.use('/exam', require('./routes/examPaper'));
app.use('/risk-score', require('./routes/riskScore'));

// Test Route: /health
app.get('/health', (req, res) => {
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const isConnected = mongoose.connection.readyState === 1;
    res.json({
        status: "ok",
        db: isConnected ? "connected" : "disconnected"
    });
});

const PORT = process.env.SERVER_PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
