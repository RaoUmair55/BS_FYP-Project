const express = require('express');
const router = express.Router();

router.post('/:examId/paper', (req, res) => {
    res.json({ message: 'POST /exam/:examId/paper' });
});

router.get('/:examId/paper', (req, res) => {
    res.json({ message: 'GET /exam/:examId/paper' });
});

module.exports = router;
