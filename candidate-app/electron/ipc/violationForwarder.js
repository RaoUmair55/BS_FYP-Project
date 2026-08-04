const { sendViolationEvent } = require('./pythonBridge');

// Receives events from Python and forwards to backend via pythonBridge
function handlePythonViolation(eventData) {
    sendViolationEvent(eventData);
}

module.exports = {
    handlePythonViolation
};
