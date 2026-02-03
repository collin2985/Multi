/**
 * TimeTrackerService
 *
 * Centralized time tracking system for all server-side time-based mechanics.
 * Consolidates multiple intervals into two efficient buckets:
 * - 1 minute interval: Frequent updates (firewood, cooking, AI, player cleanup, tree growth)
 * - 10 minute interval: Infrequent updates (gardens, apple trees)
 */

class TimeTrackerService {
    constructor() {
        this.minuteHandlers = new Map();
        this.tenMinuteHandlers = new Map();
        this.minuteInterval = null;
        this.tenMinuteInterval = null;
        this.isRunning = false;
        this.lastMinuteTickTime = 0;  // Track when the last minute tick occurred
    }

    /**
     * Start the time tracking intervals
     */
    start() {
        if (this.isRunning) {
            console.warn('TimeTrackerService already running');
            return;
        }

        // Initialize last tick time (so first cooking operations have a valid reference)
        this.lastMinuteTickTime = Date.now();

        // 1 minute interval
        this.minuteInterval = setInterval(() => {
            this.lastMinuteTickTime = Date.now();  // Track tick time
            const startTime = this.lastMinuteTickTime;
            let handlerCount = 0;

            for (const [name, handler] of this.minuteHandlers) {
                try {
                    handler();
                    handlerCount++;
                } catch (error) {
                    console.error(`Error in minute handler '${name}':`, error);
                }
            }

            const elapsed = Date.now() - startTime;
            if (elapsed > 5000) {
                console.warn(`Minute handlers took ${elapsed}ms to process ${handlerCount} handlers`);
            }
        }, 60 * 1000);

        // 10 minute interval
        this.tenMinuteInterval = setInterval(() => {
            const startTime = Date.now();

            for (const [name, handler] of this.tenMinuteHandlers) {
                try {
                    handler();
                } catch (error) {
                    console.error(`Error in ten-minute handler '${name}':`, error);
                }
            }

            const elapsed = Date.now() - startTime;
            if (elapsed > 10000) {
                console.warn(`Ten-minute handlers took ${elapsed}ms`);
            }
        }, 10 * 60 * 1000);

        this.isRunning = true;
    }

    /**
     * Stop all intervals and clean up
     */
    stop() {
        if (this.minuteInterval) {
            clearInterval(this.minuteInterval);
            this.minuteInterval = null;
        }

        if (this.tenMinuteInterval) {
            clearInterval(this.tenMinuteInterval);
            this.tenMinuteInterval = null;
        }

        this.isRunning = false;
    }

    /**
     * Register a handler to run every minute
     * @param {string} name - Unique identifier for this handler
     * @param {Function} handler - Function to execute every minute
     */
    registerMinuteHandler(name, handler) {
        if (this.minuteHandlers.has(name)) {
            console.warn(`Minute handler '${name}' already registered, replacing...`);
        }
        this.minuteHandlers.set(name, handler);
    }

    /**
     * Register a handler to run every 10 minutes
     * @param {string} name - Unique identifier for this handler
     * @param {Function} handler - Function to execute every 10 minutes
     */
    registerTenMinuteHandler(name, handler) {
        if (this.tenMinuteHandlers.has(name)) {
            console.warn(`Ten-minute handler '${name}' already registered, replacing...`);
        }
        this.tenMinuteHandlers.set(name, handler);
    }

    /**
     * Unregister a minute handler
     * @param {string} name - Handler name to remove
     */
    unregisterMinuteHandler(name) {
        if (this.minuteHandlers.delete(name)) {
            return true;
        }
        return false;
    }

    /**
     * Unregister a ten-minute handler
     * @param {string} name - Handler name to remove
     */
    unregisterTenMinuteHandler(name) {
        if (this.tenMinuteHandlers.delete(name)) {
            return true;
        }
        return false;
    }

    /**
     * Get the estimated time of the next minute tick
     * Used by cooking systems to calculate completion ETA
     * @returns {number} Timestamp of next tick (may be slightly in the past if called right after tick)
     */
    getNextMinuteTickTime() {
        return this.lastMinuteTickTime + 60000;
    }

    /**
     * Calculate the estimated completion time for a cooking operation
     * Accounts for actual cook duration plus waiting for next server tick
     * @param {number} startTime - When cooking started
     * @param {number} duration - How long cooking takes in ms
     * @returns {number} Estimated completion timestamp
     */
    calculateCompletionETA(startTime, duration) {
        const cookingDoneTime = startTime + duration;
        const nextTick = this.getNextMinuteTickTime();

        // Find the first tick that occurs after cooking is done
        let completionTick = nextTick;
        while (completionTick < cookingDoneTime) {
            completionTick += 60000;
        }

        return completionTick;
    }
}

module.exports = TimeTrackerService;
