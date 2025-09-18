const WebSocket = require('ws');
const { startWebSocketServer } = require('./wsServer');

const wss = new WebSocket.Server({ port: 8080 });
console.log('Server started on port 8080');

startWebSocketServer(wss);