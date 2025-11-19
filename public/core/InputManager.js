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

        // Bind event handlers
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);

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

        if (this.onPointerDownCallback) {
            this.onPointerDownCallback(event, this.pointer, this.raycaster);
        }
    }

    /**
     * Handle pointer move event
     * @private
     */
    handlePointerMove(event) {
        // Only process moves over canvas
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
        if (this.onPointerUpCallback) {
            this.onPointerUpCallback(event);
        }
    }

    /**
     * Handle key down event
     * @private
     */
    handleKeyDown(event) {
        this.keys.add(event.key.toLowerCase());

        if (this.onKeyDownCallback) {
            this.onKeyDownCallback(event);
        }
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
    }
}
