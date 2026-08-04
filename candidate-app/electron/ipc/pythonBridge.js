// Polls Python's /health endpoint on localhost
// Exposes sendViolationEvent(payload) that POSTs to the backend server

function sendViolationEvent(payload) {
    console.log('Forwarding violation to backend:', payload);
    // TODO: implement actual POST request
}

module.exports = {
    sendViolationEvent
};
