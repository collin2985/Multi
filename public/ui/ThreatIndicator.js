/**
 * ThreatIndicator.js
 * Red screen edge glow indicating direction of nearest enemy
 * Uses screen-space projection for accurate positioning
 */

import * as THREE from 'three';

export class ThreatIndicator {
    constructor() {
        this.container = null;
        this.glowElement = null;
        this.active = false;
        this.tempVec = new THREE.Vector3();
        // Reusable screen coordinate storage to avoid allocations
        this.enemyScreen = { x: 0, y: 0, behind: false };
        this.playerScreen = { x: 0, y: 0, behind: false };
        this.edgePoint = { x: 0, y: 0 };

        this.createElements();
    }

    createElements() {
        // Container covers full screen, pointer-events none
        this.container = document.createElement('div');
        this.container.id = 'threat-indicator';
        this.container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 100;
            opacity: 0;
            transition: opacity 0.2s ease-out;
        `;

        // Glow element - radial gradient positioned at edge
        this.glowElement = document.createElement('div');
        this.glowElement.style.cssText = `
            position: absolute;
            width: 300px;
            height: 300px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(255, 0, 0, 0.4) 0%, rgba(255, 0, 0, 0) 70%);
            transform: translate(-50%, -50%);
            pointer-events: none;
        `;

        this.container.appendChild(this.glowElement);
        document.body.appendChild(this.container);
    }

    /**
     * Project world position to screen coordinates
     * @param {{x,y,z}} worldPos - World position
     * @param {THREE.Camera} camera - Camera for projection
     * @param {{x: number, y: number, behind: boolean}} out - Output object to store result (avoids allocation)
     */
    projectToScreen(worldPos, camera, out) {
        this.tempVec.set(worldPos.x, worldPos.y, worldPos.z);
        this.tempVec.project(camera);

        // z > 1 means the point is behind the camera
        out.behind = this.tempVec.z > 1;

        out.x = (this.tempVec.x + 1) / 2 * window.innerWidth;
        out.y = (-this.tempVec.y + 1) / 2 * window.innerHeight;
    }

    /**
     * Find where a ray from start in direction (dx, dy) hits screen edge
     * @param {number} startX - Start X in screen coords
     * @param {number} startY - Start Y in screen coords
     * @param {number} dx - Direction X
     * @param {number} dy - Direction Y
     * @param {{x: number, y: number}} out - Output object to store result
     */
    findEdgeIntersection(startX, startY, dx, dy, out) {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        // Normalize direction
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) {
            out.x = screenW / 2;
            out.y = screenH / 2;
            return;
        }

        const ndx = dx / len;
        const ndy = dy / len;

        let tMin = Infinity;
        let edgeX = startX;
        let edgeY = startY;

        // Right edge (x = screenW)
        if (ndx > 0) {
            const t = (screenW - startX) / ndx;
            const y = startY + t * ndy;
            if (y >= 0 && y <= screenH && t > 0 && t < tMin) {
                tMin = t;
                edgeX = screenW;
                edgeY = y;
            }
        }

        // Left edge (x = 0)
        if (ndx < 0) {
            const t = -startX / ndx;
            const y = startY + t * ndy;
            if (y >= 0 && y <= screenH && t > 0 && t < tMin) {
                tMin = t;
                edgeX = 0;
                edgeY = y;
            }
        }

        // Bottom edge (y = screenH)
        if (ndy > 0) {
            const t = (screenH - startY) / ndy;
            const x = startX + t * ndx;
            if (x >= 0 && x <= screenW && t > 0 && t < tMin) {
                tMin = t;
                edgeX = x;
                edgeY = screenH;
            }
        }

        // Top edge (y = 0)
        if (ndy < 0) {
            const t = -startY / ndy;
            const x = startX + t * ndx;
            if (x >= 0 && x <= screenW && t > 0 && t < tMin) {
                tMin = t;
                edgeX = x;
                edgeY = 0;
            }
        }

        out.x = edgeX;
        out.y = edgeY;
    }

    /**
     * Update indicator based on player and enemy positions
     * @param {THREE.Camera} camera - Game camera for projection
     * @param {{x,y,z}} playerPos - Player world position
     * @param {{x,y,z}} enemyPos - Nearest enemy world position
     * @param {boolean} inCombatStance - Whether player is in combat stance
     */
    update(camera, playerPos, enemyPos, inCombatStance) {
        if (!inCombatStance || !enemyPos || !camera) {
            this.hide();
            return;
        }

        // Project enemy position to screen space
        this.projectToScreen(enemyPos, camera, this.enemyScreen);

        // Project player position to screen space - this is where the player appears on screen
        // (lower center due to isometric camera offset)
        this.projectToScreen(playerPos, camera, this.playerScreen);

        // Direction from player's screen position to enemy in screen space
        let dx = this.enemyScreen.x - this.playerScreen.x;
        let dy = this.enemyScreen.y - this.playerScreen.y;

        // When enemy is behind camera, the projected coordinates are mirrored/inverted
        // Flip the direction to point correctly
        if (this.enemyScreen.behind) {
            dx = -dx;
            dy = -dy;
        }

        // Find where this line hits the screen edge (starting from player's screen position)
        this.findEdgeIntersection(this.playerScreen.x, this.playerScreen.y, dx, dy, this.edgePoint);

        // Position glow at edge
        this.glowElement.style.left = `${this.edgePoint.x}px`;
        this.glowElement.style.top = `${this.edgePoint.y}px`;

        this.show();
    }

    show() {
        if (!this.active) {
            this.active = true;
            this.container.style.opacity = '1';
        }
    }

    hide() {
        if (this.active) {
            this.active = false;
            this.container.style.opacity = '0';
        }
    }

    /**
     * Clean up DOM elements
     */
    dispose() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
        this.glowElement = null;
    }
}
