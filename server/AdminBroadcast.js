/**
 * AdminBroadcast.js
 * CLI tool to send admin broadcast messages to all connected players
 *
 * Usage:
 *   node server/AdminBroadcast.js "Your message here"
 *
 * Example:
 *   node server/AdminBroadcast.js "Server restarting in 5 minutes!"
 *
 * Requires ADMIN_SECRET in .env file
 */

const WebSocket = require('ws');
require('dotenv').config();

// Get message from command line args
const message = process.argv[2];

if (!message) {
    console.error('Usage: node server/AdminBroadcast.js "Your message here"');
    console.error('Example: node server/AdminBroadcast.js "Server restarting in 5 minutes!"');
    process.exit(1);
}

const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
    console.error('Error: ADMIN_SECRET not found in .env file');
    console.error('Add ADMIN_SECRET=your-secret-here to your .env file');
    process.exit(1);
}

// Connect to the production server
const SERVER_URL = 'wss://multiplayer-game-dcwy.onrender.com';

console.log(`Connecting to ${SERVER_URL}...`);

const ws = new WebSocket(SERVER_URL);

ws.on('open', () => {
    console.log('Connected to server');
    console.log(`Sending broadcast: "${message}"`);

    ws.send(JSON.stringify({
        type: 'admin_broadcast',
        payload: {
            secret: ADMIN_SECRET,
            message: message
        }
    }));
});

ws.on('message', (data) => {
    try {
        const response = JSON.parse(data);
        if (response.type === 'admin_broadcast_response') {
            if (response.payload.success) {
                console.log(`Success! Message broadcast to ${response.payload.playerCount} players.`);
            } else {
                console.error(`Failed: ${response.payload.error}`);
            }
            ws.close();
            process.exit(response.payload.success ? 0 : 1);
        }
    } catch (e) {
        // Ignore other messages
    }
});

ws.on('error', (error) => {
    console.error('Connection error:', error.message);
    process.exit(1);
});

ws.on('close', () => {
    console.log('Disconnected from server');
});

// Timeout after 10 seconds
setTimeout(() => {
    console.error('Timeout: No response from server');
    ws.close();
    process.exit(1);
}, 10000);
