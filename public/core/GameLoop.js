/**
 * GameLoop.js
 * Core game loop with frame timing and update callbacks
 */

export class GameLoop {
    constructor() {
        this.isRunning = false;
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.fpsUpdateInterval = 500; // Update FPS every 500ms
        this.lastFpsUpdate = 0;
        this.currentFPS = 0;

        // Callbacks
        this.updateCallback = null;
        this.renderCallback = null;
        this.fpsUpdateCallback = null;

        // DEBUG: Frame timing diagnostics
        this._frameTimes = [];
        this._lastDiagnosticLog = 0;
        this._longFrameThreshold = 33; // Log frames longer than 33ms (~30fps)

        // Bind animate to preserve context
        this.animate = this.animate.bind(this);
    }

    /**
     * Start the game loop
     */
    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.lastFrameTime = performance.now();
        this.animate();
    }

    /**
     * Stop the game loop
     */
    stop() {
        this.isRunning = false;
    }

    /**
     * Main animation loop
     * @private
     */
    animate() {
        if (!this.isRunning) return;

        requestAnimationFrame(this.animate);

        const frameStartTime = performance.now();
        const now = frameStartTime;
        const rawDelta = now - this.lastFrameTime;
        // Cap deltaTime to prevent huge values after browser tab is minimized/backgrounded
        // 100ms = ~10fps minimum, prevents AI movement overshoots and state machine issues
        const deltaTime = Math.min(rawDelta, 100);

        // Increment frame counter
        this.frameCount++;

        // Calculate FPS
        if (now - this.lastFpsUpdate >= this.fpsUpdateInterval) {
            const elapsed = now - this.lastFpsUpdate;
            this.currentFPS = Math.round((this.frameCount * 1000) / elapsed);
            this.frameCount = 0;
            this.lastFpsUpdate = now;

            if (this.fpsUpdateCallback) {
                this.fpsUpdateCallback(this.currentFPS);
            }
        }

        // Call update callback
        if (this.updateCallback) {
            this.updateCallback(deltaTime, now);
        }

        // Call render callback
        if (this.renderCallback) {
            this.renderCallback();
        }

        // DEBUG: Frame timing diagnostics
        const frameEndTime = performance.now();
        const frameTime = frameEndTime - frameStartTime;
        this._frameTimes.push(frameTime);

        // Keep last 120 frame times (2 seconds at 60fps)
        if (this._frameTimes.length > 120) {
            this._frameTimes.shift();
        }

        // Track diagnostics timing (no logging)
        if (now - this._lastDiagnosticLog > 5000) {
            this._lastDiagnosticLog = now;
        }

        // Update last frame time
        this.lastFrameTime = now;
    }

    /**
     * Set the update callback
     * @param {function} callback - Called every frame with (deltaTime, now)
     */
    onUpdate(callback) {
        this.updateCallback = callback;
    }

    /**
     * Set the render callback
     * @param {function} callback - Called every frame for rendering
     */
    onRender(callback) {
        this.renderCallback = callback;
    }

    /**
     * Set the FPS update callback
     * @param {function} callback - Called when FPS is recalculated
     */
    onFPSUpdate(callback) {
        this.fpsUpdateCallback = callback;
    }

    /**
     * Get current FPS
     * @returns {number}
     */
    getFPS() {
        return this.currentFPS;
    }
}
