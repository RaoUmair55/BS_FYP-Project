const express = require('express');
const router = express.Router();

router.post('/', (req, res) => {
    res.json({ message: 'POST /violation' });
});

router.get('/:sessionId', (req, res) => {
    res.json({ message: 'GET /violations/:sessionId' });
});

module.exports = router;
