/**
 * InputManager.js
 * Manages mouse, keyboard, and touch input
 */

import * as THREE from 'three';

export class InputManager {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement || document.body;

        // Input state
        this.pointer = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.keys = new Set();

        // Callbacks
        this.onPointerDownCallback = null;
        this.onPointerMoveCallback = null;
        this.onPointerUpCallback = null;
        this.onKeyDownCallback = null;
        this.onKeyUpCallback = null;

        // Drag state
        this.isDragging = false;
        this.lastDragX = 0;
        this.lastDragY = 0;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.totalDragDistance = 0;
        this.dragThreshold = 5;  // Pixels before considered a drag vs click
        this.wasDrag = false;    // True if this interaction was a drag (for click filtering)

        // Drag callbacks
        this.onDragStartCallback = null;
        this.onDragMoveCallback = null;
        this.onDragEndCallback = null;
        this.onWheelCallback = null;

        // Escape handlers (sorted by priority, higher = checked first)
        this.escapeHandlers = [];

        // Auto-run state (double-tap W to toggle)
        this.autoRun = false;
        this.lastWPressTime = 0;
        this.DOUBLE_TAP_THRESHOLD = 300; // ms

        // Bind event handlers
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleWheel = this.handleWheel.bind(this);

        this.setupEventListeners();
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        window.addEventListener('pointerdown', this.handlePointerDown);
        window.addEventListener('pointermove', this.handlePointerMove);
        window.addEventListener('pointerup', this.handlePointerUp);
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        window.addEventListener('wheel', this.handleWheel, { passive: false });
    }

    /**
     * Handle pointer down event
     * @private
     */
    handlePointerDown(event) {
        // Only process clicks on canvas
        if (event.target.tagName !== 'CANVAS') return;

        // Update pointer coordinates
        this.updatePointerCoordinates(event);

        // Track drag start position
        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;
        this.lastDragX = event.clientX;
        this.lastDragY = event.clientY;
        this.totalDragDistance = 0;
        this.wasDrag = false;
        this.isDragging = true;

        // Notify drag start (before threshold is crossed)
        if (this.onDragStartCallback) {
            this.onDragStartCallback(event);
        }

        // Don't call onPointerDownCallback here - wait for pointer up to determine if click or drag
    }

    /**
     * Handle pointer move event
     * @private
     */
    handlePointerMove(event) {
        // Handle drag movement (works even if not over canvas, for smooth dragging)
        if (this.isDragging) {
            const deltaX = event.clientX - this.lastDragX;
            const deltaY = event.clientY - this.lastDragY;
            this.lastDragX = event.clientX;
            this.lastDragY = event.clientY;

            // Track total drag distance
            this.totalDragDistance += Math.abs(deltaX) + Math.abs(deltaY);

            // Mark as drag once threshold is crossed
            if (this.totalDragDistance >= this.dragThreshold) {
                this.wasDrag = true;
            }

            if (this.onDragMoveCallback) {
                this.onDragMoveCallback(deltaX, deltaY, event, this.wasDrag);
            }
        }

        // Only process moves over canvas for other callbacks
        if (event.target.tagName !== 'CANVAS') return;

        // Update pointer coordinates
        this.updatePointerCoordinates(event);

        if (this.onPointerMoveCallback) {
            this.onPointerMoveCallback(event, this.pointer, this.raycaster);
        }
    }

    /**
     * Handle pointer up event
     * @private
     */
    handlePointerUp(event) {
        const wasDragInteraction = this.wasDrag;

        if (this.isDragging) {
            this.isDragging = false;
            if (this.onDragEndCallback) {
                this.onDragEndCallback(event, wasDragInteraction);
            }
        }

        // Only trigger click (pointer down callback) if it was NOT a drag
        // This allows distinguishing click from click-and-hold-drag
        if (!wasDragInteraction && this.onPointerDownCallback) {
            this.onPointerDownCallback(event, this.pointer, this.raycaster);
        }

        if (this.onPointerUpCallback) {
            this.onPointerUpCallback(event);
        }
    }

    /**
     * Handle wheel event
     * @private
     */
    handleWheel(event) {
        // Only process wheel on canvas
        if (event.target.tagName !== 'CANVAS') return;

        // Prevent page scroll
        event.preventDefault();

        if (this.onWheelCallback) {
            this.onWheelCallback(event.deltaY);
        }
    }

    /**
     * Handle key down event
     * @private
     */
    handleKeyDown(event) {
        const key = event.key.toLowerCase();
        this.keys.add(key);

        // Double-tap W detection for auto-run toggle
        if (key === 'w') {
            const now = performance.now();
            if (this.autoRun) {
                // Already auto-running, W cancels it
                this.autoRun = false;
            } else if (now - this.lastWPressTime < this.DOUBLE_TAP_THRESHOLD) {
                // Double-tap detected, start auto-run
                this.autoRun = true;
            }
            this.lastWPressTime = now;
        }

        // Handle Escape key - try registered handlers in priority order
        if (event.key === 'Escape') {
            for (const handler of this.escapeHandlers) {
                if (handler.callback()) {
                    return; // Handler handled it, stop processing
                }
            }
        }

        if (this.onKeyDownCallback) {
            this.onKeyDownCallback(event);
        }
    }

    /**
     * Cancel auto-run mode
     * Called when player opens menus, starts actions, hits obstacles, etc.
     */
    cancelAutoRun() {
        this.autoRun = false;
    }

    /**
     * Register an escape key handler
     * @param {function} callback - Returns true if it handled the escape (closes something)
     * @param {number} priority - Higher priority handlers are checked first (default 0)
     */
    registerEscapeHandler(callback, priority = 0) {
        this.escapeHandlers.push({ callback, priority });
        this.escapeHandlers.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Handle key up event
     * @private
     */
    handleKeyUp(event) {
        this.keys.delete(event.key.toLowerCase());

        if (this.onKeyUpCallback) {
            this.onKeyUpCallback(event);
        }
    }

    /**
     * Update pointer coordinates to normalized device coordinates
     * @private
     */
    updatePointerCoordinates(event) {
        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

        // Update raycaster
        this.raycaster.setFromCamera(this.pointer, this.camera);
    }

    /**
     * Check if a key is currently pressed
     * @param {string} key - Key to check
     * @returns {boolean}
     */
    isKeyPressed(key) {
        return this.keys.has(key.toLowerCase());
    }

    /**
     * Get raycast intersections with objects
     * @param {Array<THREE.Object3D>} objects - Objects to raycast against
     * @param {boolean} recursive - Whether to check children
     * @returns {Array} - Intersection results
     */
    raycast(objects, recursive = true) {
        return this.raycaster.intersectObjects(objects, recursive);
    }

    /**
     * Set pointer down callback
     * @param {function} callback - Called with (event, pointer, raycaster)
     */
    onPointerDown(callback) {
        this.onPointerDownCallback = callback;
    }

    /**
     * Set pointer move callback
     * @param {function} callback - Called with (event, pointer, raycaster)
     */
    onPointerMove(callback) {
        this.onPointerMoveCallback = callback;
    }

    /**
     * Set pointer up callback
     * @param {function} callback - Called with (event)
     */
    onPointerUp(callback) {
        this.onPointerUpCallback = callback;
    }

    /**
     * Set key down callback
     * @param {function} callback - Called with (event)
     */
    onKeyDown(callback) {
        this.onKeyDownCallback = callback;
    }

    /**
     * Set key up callback
     * @param {function} callback - Called with (event)
     */
    onKeyUp(callback) {
        this.onKeyUpCallback = callback;
    }

    /**
     * Set wheel callback
     * @param {function} callback - Called with (deltaY)
     */
    onWheel(callback) {
        this.onWheelCallback = callback;
    }

    /**
     * Set drag start callback
     * @param {function} callback - Called with (event)
     */
    onDragStart(callback) {
        this.onDragStartCallback = callback;
    }

    /**
     * Set drag move callback
     * @param {function} callback - Called with (deltaX, deltaY, event)
     */
    onDragMove(callback) {
        this.onDragMoveCallback = callback;
    }

    /**
     * Set drag end callback
     * @param {function} callback - Called with (event)
     */
    onDragEnd(callback) {
        this.onDragEndCallback = callback;
    }

    /**
     * Get current pointer position
     * @returns {THREE.Vector2}
     */
    getPointer() {
        return this.pointer;
    }

    /**
     * Get raycaster
     * @returns {THREE.Raycaster}
     */
    getRaycaster() {
        return this.raycaster;
    }

    /**
     * Cleanup event listeners
     */
    dispose() {
        window.removeEventListener('pointerdown', this.handlePointerDown);
        window.removeEventListener('pointermove', this.handlePointerMove);
        window.removeEventListener('pointerup', this.handlePointerUp);
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        window.removeEventListener('wheel', this.handleWheel);
    }
}
