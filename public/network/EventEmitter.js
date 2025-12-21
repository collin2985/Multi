/**
 * EventEmitter.js
 * Simple event emitter for decoupled communication
 */

export class EventEmitter {
    constructor() {
        this.events = new Map();
    }

    /**
     * Register an event listener
     * @param {string} event - Event name
     * @param {function} callback - Callback function
     */
    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
    }

    /**
     * Unregister an event listener
     * @param {string} event - Event name
     * @param {function} callback - Callback function to remove
     */
    off(event, callback) {
        if (!this.events.has(event)) return;

        const callbacks = this.events.get(event);
        const index = callbacks.indexOf(callback);
        if (index !== -1) {
            callbacks.splice(index, 1);
        }
    }

    /**
     * Emit an event to all listeners
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        if (!this.events.has(event)) return;

        const callbacks = this.events.get(event);
        callbacks.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
            }
        });
    }
}
