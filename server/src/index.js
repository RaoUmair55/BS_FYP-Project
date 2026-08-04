const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// connectDB(); // Un-comment when ready to test mongodb

require('./sockets/violationSocket')(io);

app.use('/violations', require('./routes/violations'));
app.use('/sessions', require('./routes/sessions'));
app.use('/submissions', require('./routes/submissions'));
app.use('/exam', require('./routes/examPaper'));

app.use(require('./middleware/errorHandler'));

const PORT = process.env.SERVER_PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
