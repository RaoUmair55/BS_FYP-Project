const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const router = express.Router();
// The main application keeps Helmet's default policy; only this isolated page runs local WASM.
router.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    connectSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'],
    styleSrc: ["'self'"], workerSrc: ["'self'", 'blob:']
} } }));
router.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), accelerometer=(self), gyroscope=(self), magnetometer=(self)');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'no-store');
    next();
});
router.use(express.static(path.join(__dirname, '../../public/side-camera')));
module.exports = router;
