/**
 * CameraController.js
 * Controls camera movement, zoom, and target following
 */

import * as THREE from 'three';

export class CameraController {
    constructor(camera) {
        this.camera = camera;

        // Camera state
        this.targetPosition = new THREE.Vector3();
        this.zoomMin = 1.0;   // Minimum zoom (default view)
        this.zoomMax = 2.0;   // Maximum zoom (farther)
        this.zoom = 1.0;      // Default zoom
        this.zoomSpeed = 0.05;

        // Camera offset and smoothing
        this.smoothFactor = 0.8;

        // Camera rotation (around Y axis, in radians)
        // Default to π so camera starts behind player facing North (+Z)
        this.rotation = Math.PI;

        // Drag rotation state
        this.isDragging = false;
        this.dragSensitivity = 0.005;      // Radians per pixel (horizontal)

        // Pitch control (vertical mouse movement)
        this.pitch = 0;                     // 0 = default angle, 0.8 = max overhead
        this.pitchMin = 0;
        this.pitchMax = 0.8;                // Limited to prevent fully overhead view
        this.pitchSensitivity = 0.003;      // Pitch change per pixel

        // Offset interpolation for pitch
        this.defaultOffset = new THREE.Vector3(0, 12, 12);   // Far/angled view (current)
        this.overheadOffset = new THREE.Vector3(0, 20, 3);   // Close/overhead view

        // Pre-allocated vectors for update() - reused every frame
        this._lerpedOffset = new THREE.Vector3();
        this._zoomedOffset = new THREE.Vector3();
        this._rotatedOffset = new THREE.Vector3();
        this._lookAtPoint = new THREE.Vector3();

        // Look-ahead interpolation for pitch
        this.defaultLookAhead = 15;
        this.overheadLookAhead = 5;

        // Scroll zoom
        this.scrollZoomSpeed = 0.1;

        // Target to follow
        this.target = null;
    }

    /**
     * Set the target object for the camera to follow
     * @param {THREE.Object3D} target
     */
    setTarget(target) {
        this.target = target;
    }

    /**
     * Update camera position to follow target
     * @param {number} deltaTime - Time since last frame (optional, for future use)
     */
    update(deltaTime = 0) {
        if (!this.target) return;

        // Interpolate offset based on pitch (0 = default, 1 = overhead)
        this._lerpedOffset.lerpVectors(this.defaultOffset, this.overheadOffset, this.pitch);

        // Apply zoom to the interpolated offset
        this._zoomedOffset.copy(this._lerpedOffset).multiplyScalar(this.zoom);

        // Rotate the offset around Y axis
        const cos = Math.cos(this.rotation);
        const sin = Math.sin(this.rotation);
        this._rotatedOffset.set(
            this._zoomedOffset.x * cos - this._zoomedOffset.z * sin,
            this._zoomedOffset.y,
            this._zoomedOffset.x * sin + this._zoomedOffset.z * cos
        );

        // Set target camera position
        this.targetPosition.copy(this.target.position).add(this._rotatedOffset);

        // Smoothly move camera towards target position
        this.camera.position.lerp(this.targetPosition, this.smoothFactor);

        // Interpolate look-ahead distance based on pitch
        const currentLookAhead = THREE.MathUtils.lerp(
            this.defaultLookAhead,
            this.overheadLookAhead,
            this.pitch
        );

        // Look at a point ahead of the target (opposite side from camera)
        this._lookAtPoint.copy(this.target.position);
        this._lookAtPoint.x += currentLookAhead * sin;
        this._lookAtPoint.z -= currentLookAhead * cos;
        this.camera.lookAt(this._lookAtPoint);
    }

    /**
     * Zoom camera in (closer to target)
     */
    zoomIn() {
        this.zoom = Math.max(this.zoomMin, this.zoom - this.zoomSpeed);
    }

    /**
     * Zoom camera out (farther from target)
     */
    zoomOut() {
        this.zoom = Math.min(this.zoomMax, this.zoom + this.zoomSpeed);
    }

    /**
     * Rotate camera 15 degrees left (counter-clockwise)
     */
    rotateLeft() {
        this.rotation -= Math.PI / 12;
    }

    /**
     * Rotate camera 15 degrees right (clockwise)
     */
    rotateRight() {
        this.rotation += Math.PI / 12;
    }

    /**
     * Set zoom level
     * @param {number} zoom - Zoom level (zoomMin to zoomMax)
     */
    setZoom(zoom) {
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, zoom));
    }

    /**
     * Get current zoom level
     * @returns {number}
     */
    getZoom() {
        return this.zoom;
    }

    /**
     * Set camera offset from target
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    setOffset(x, y, z) {
        this.baseOffset.set(x, y, z);
    }

    /**
     * Set camera smooth factor (0 = no smoothing, 1 = instant)
     * @param {number} factor - 0.0 to 1.0
     */
    setSmoothFactor(factor) {
        this.smoothFactor = Math.max(0, Math.min(1, factor));
    }

    /**
     * Set zoom range
     * @param {number} min
     * @param {number} max
     */
    setZoomRange(min, max) {
        this.zoomMin = min;
        this.zoomMax = max;
        this.zoom = Math.max(min, Math.min(max, this.zoom));
    }

    /**
     * Start camera drag
     */
    startDrag() {
        this.isDragging = true;
    }

    /**
     * End camera drag
     */
    endDrag() {
        this.isDragging = false;
    }

    /**
     * Update rotation and pitch from mouse drag
     * @param {number} deltaX - Horizontal mouse movement in pixels
     * @param {number} deltaY - Vertical mouse movement in pixels
     */
    updateDrag(deltaX, deltaY) {
        if (!this.isDragging) return;

        // Horizontal drag = rotation around player
        this.rotation -= deltaX * this.dragSensitivity;

        // Vertical drag = pitch adjustment
        // Mouse up (negative deltaY) = increase pitch (more overhead)
        // Mouse down (positive deltaY) = decrease pitch (back to default)
        this.pitch -= deltaY * this.pitchSensitivity;
        this.pitch = Math.max(this.pitchMin, Math.min(this.pitchMax, this.pitch));
    }

    /**
     * Zoom with scroll wheel
     * @param {number} delta - Scroll delta (negative = zoom in, positive = zoom out)
     */
    scrollZoom(delta) {
        if (delta < 0) {
            this.zoom = Math.max(this.zoomMin, this.zoom - this.scrollZoomSpeed);
        } else {
            this.zoom = Math.min(this.zoomMax, this.zoom + this.scrollZoomSpeed);
        }
    }

    /**
     * Get current rotation (for WASD direction calculation)
     * @returns {number} Camera rotation in radians
     */
    getRotation() {
        return this.rotation;
    }

    /**
     * Check if camera is being dragged
     * @returns {boolean}
     */
    getIsDragging() {
        return this.isDragging;
    }
}
