/**
 * MessageQueue.js
 * Pure message buffering system - NO game logic
 * Buffers network messages between reception and processing
 */

export class MessageQueue {
    constructor() {
        this.queue = [];
    }

    /**
     * Add a message to the queue
     * @param {object} message - The message object (already parsed JSON)
     * @param {string} source - Source of message ('server', 'peer', etc.)
     */
    enqueue(message, source = 'unknown') {
        this.queue.push({
            message,
            source,
            timestamp: Date.now()
        });
    }

    /**
     * Get and remove the next message from the queue
     * @returns {object|null} - The queued message item or null if empty
     */
    dequeue() {
        if (this.queue.length === 0) {
            return null;
        }
        return this.queue.shift();
    }

    /**
     * Check if there are messages waiting
     * @returns {boolean}
     */
    hasMessages() {
        return this.queue.length > 0;
    }

    /**
     * Get the number of messages in the queue
     * @returns {number}
     */
    size() {
        return this.queue.length;
    }

    /**
     * Clear all messages from the queue
     */
    clear() {
        this.queue.length = 0;
    }

    /**
     * Peek at the next message without removing it
     * @returns {object|null}
     */
    peek() {
        if (this.queue.length === 0) {
            return null;
        }
        return this.queue[0];
    }
}
