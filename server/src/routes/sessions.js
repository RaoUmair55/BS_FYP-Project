const express = require('express');
const router = express.Router();

router.get('/active', (req, res) => {
    res.json({ message: 'GET /sessions/active' });
});

module.exports = router;
