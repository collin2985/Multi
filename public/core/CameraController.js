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
        this.zoom = 1.0;
        this.zoomMin = 0.5;   // Double zoom in (closer)
        this.zoomMax = 2.0;   // Double zoom out (farther)
        this.zoomSpeed = 0.05;

        // Camera offset and smoothing
        this.baseOffset = new THREE.Vector3(0, 12, 12);  // Higher (Y=12) and back (Z=12) for correct skybox view
        this.smoothFactor = 0.8;

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

        // Calculate zoomed offset
        const zoomedOffset = this.baseOffset.clone().multiplyScalar(this.zoom);

        // Set target camera position
        this.targetPosition.copy(this.target.position).add(zoomedOffset);

        // Smoothly move camera towards target position
        this.camera.position.lerp(this.targetPosition, this.smoothFactor);

        // Look at a point 15 units behind the target
        const lookAtPoint = this.target.position.clone();
        lookAtPoint.z -= 15;
        this.camera.lookAt(lookAtPoint);
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
}
