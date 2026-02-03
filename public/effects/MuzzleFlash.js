/**
 * MuzzleFlash.js
 * Lightweight muzzle flash effect using shared procedural texture
 */

import * as THREE from 'three';

// Shared texture - created once, reused by all instances
let sharedTexture = null;

/**
 * Create procedural muzzle flash texture (64x64 radial gradient)
 */
function createMuzzleFlashTexture() {
    if (sharedTexture) return sharedTexture;

    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Radial gradient - bright center fading to transparent
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, 'rgba(255, 255, 220, 1)');    // Bright yellow-white center
    gradient.addColorStop(0.2, 'rgba(255, 220, 100, 0.9)'); // Yellow
    gradient.addColorStop(0.5, 'rgba(255, 150, 50, 0.5)');  // Orange
    gradient.addColorStop(1, 'rgba(255, 80, 0, 0)');        // Transparent edge

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    sharedTexture = new THREE.CanvasTexture(canvas);
    return sharedTexture;
}

export class MuzzleFlash {
    constructor() {
        const texture = createMuzzleFlashTexture();

        const material = new THREE.SpriteMaterial({
            map: texture,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false
        });

        this.sprite = new THREE.Sprite(material);
        this.sprite.scale.set(0.7, 0.7, 1);
        this.sprite.visible = false;

        this.hideTimeout = null;
    }

    /**
     * Attach to a rifle mesh at barrel tip
     * @param {THREE.Object3D} rifle - The rifle to attach to
     * @param {THREE.Vector3} offset - Local offset to barrel tip
     */
    attachTo(rifle, offset) {
        if (offset) {
            this.sprite.position.copy(offset);
        } else {
            // Default offset - will need tuning
            this.sprite.position.set(0, 0.05, 0.12);
        }
        rifle.add(this.sprite);
    }

    /**
     * Trigger the flash effect
     * @param {number} duration - How long to show in ms (default 80)
     */
    flash(duration = 110) {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }

        this.sprite.visible = true;

        this.hideTimeout = setTimeout(() => {
            this.sprite.visible = false;
            this.hideTimeout = null;
        }, duration);
    }

    /**
     * Clean up resources
     */
    dispose() {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }
        if (this.sprite.parent) {
            this.sprite.parent.remove(this.sprite);
        }
        this.sprite.material.dispose();
    }
}
