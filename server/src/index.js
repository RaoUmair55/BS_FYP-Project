const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/db');
const { initSocket } = require('./sockets/violationSocket');

const app = express();
const server = http.createServer(app);

// Global Security & Parser Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cookieParser());
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads (for screenshots, papers, verification photos)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Initialize Socket.io
const io = initSocket(server);
app.locals.io = io; // Make io accessible in routes

// Connect to MongoDB (without crashing if it fails)
connectDB();

// Mount Routes
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/violations'));
app.use('/sessions', require('./routes/sessions'));
app.use('/exam', require('./routes/examPaper'));
app.use('/exams', require('./routes/exams'));
app.use('/risk-score', require('./routes/riskScore'));
app.use('/submissions', require('./routes/submissions'));

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
