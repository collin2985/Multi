/**
 * NameTagManager.js
 * Manages floating name tags above entities with distance-based visibility
 * Updates once per server tick for performance
 */

import * as THREE from 'three';

export class NameTagManager {
    constructor(scene) {
        this.scene = scene;
        this.tags = new Map(); // entityId -> { sprite, canvas, ctx, mesh, displayName, isDead, visible }

        // Configuration
        this.VISIBILITY_DISTANCE_SQ = 30 * 30; // Squared for faster comparison
        this.TAG_HEIGHT_OFFSET = 2.2; // Height above entity origin
        this.TAG_SCALE = 1.5; // Base scale for sprites

        // Reusable vector for world position calculations
        this._worldPos = new THREE.Vector3();
    }

    /**
     * Draw text to a canvas with outline (no background)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @param {string} text - Text to display
     * @param {boolean} isDead - Whether to show (DEAD) suffix
     * @param {string} textColor - Text color (default white, red for enemies)
     */
    _drawToCanvas(ctx, canvas, text, isDead, textColor = '#ffffff') {
        const displayText = isDead ? `${text} (DEAD)` : text;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw black outline
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.strokeText(displayText, canvas.width / 2, canvas.height / 2);

        // Draw fill - red if dead, otherwise use provided color
        ctx.fillStyle = isDead ? '#ff4444' : textColor;
        ctx.fillText(displayText, canvas.width / 2, canvas.height / 2);
    }

    /**
     * Create a text sprite for a name tag
     * Each sprite gets its own canvas to avoid texture corruption
     * @param {string} text - Text to display
     * @param {boolean} isDead - Whether to show (DEAD) suffix
     * @returns {{sprite: THREE.Sprite, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}}
     */
    _createSprite(text, isDead = false) {
        // Each sprite gets its OWN canvas to avoid shared texture corruption
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        this._drawToCanvas(ctx, canvas, text, isDead);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false, // Always render on top
            depthWrite: false
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(this.TAG_SCALE * 4, this.TAG_SCALE, 1); // Wide aspect ratio for text
        sprite.visible = false; // Start hidden
        sprite.renderOrder = 1000; // Render after everything else

        return { sprite, canvas, ctx };
    }

    /**
     * Register an entity for name tag tracking
     * @param {string} entityId - Unique identifier
     * @param {string} displayName - Name to show (e.g., username, "Bandit", "Deer")
     * @param {THREE.Object3D} mesh - Entity mesh to attach tag to
     */
    registerEntity(entityId, displayName, mesh) {
        if (this.tags.has(entityId)) {
            // Update existing tag's text if name changed
            const tagData = this.tags.get(entityId);
            if (tagData.displayName !== displayName) {
                this._updateSpriteText(tagData, displayName, tagData.isDead);
            }
            // Update mesh reference
            tagData.mesh = mesh;
            return;
        }

        const { sprite, canvas, ctx } = this._createSprite(displayName, false);
        sprite.userData.entityId = entityId;

        // Add to scene (not parented to mesh so it survives mesh removal)
        this.scene.add(sprite);

        this.tags.set(entityId, {
            sprite,
            canvas,      // Per-sprite canvas
            ctx,         // Per-sprite context
            mesh,
            displayName,
            isDead: false,
            isEnemy: false,  // Enemy faction player (shows red name)
            visible: false,
            lastText: displayName  // Track last rendered text
        });
    }

    /**
     * Update sprite texture with new text
     * @param {object} tagData - Tag data object
     * @param {string} displayName - New display name
     * @param {boolean} isDead - Dead state
     */
    _updateSpriteText(tagData, displayName, isDead) {
        const displayText = isDead ? `${displayName} (DEAD)` : displayName;

        if (tagData.lastText === displayText) return; // No change needed

        // Draw to THIS sprite's own canvas (not shared)
        const color = tagData.isEnemy ? '#ff6666' : '#ffffff';
        this._drawToCanvas(tagData.ctx, tagData.canvas, displayName, isDead, color);

        tagData.sprite.material.map.needsUpdate = true;
        tagData.lastText = displayText;
        tagData.displayName = displayName;
        tagData.isDead = isDead;
    }

    /**
     * Mark entity as dead (shows "(DEAD)" suffix in red)
     * @param {string} entityId
     */
    setEntityDead(entityId) {
        const tagData = this.tags.get(entityId);
        if (!tagData || tagData.isDead) return;

        this._updateSpriteText(tagData, tagData.displayName, true);
    }

    /**
     * Mark entity as alive (removes "(DEAD)" suffix)
     * @param {string} entityId
     */
    setEntityAlive(entityId) {
        const tagData = this.tags.get(entityId);
        if (!tagData || !tagData.isDead) return;

        this._updateSpriteText(tagData, tagData.displayName, false);
    }

    /**
     * Mark entity as enemy (shows name in red)
     * @param {string} entityId
     * @param {boolean} isEnemy
     */
    setEntityEnemy(entityId, isEnemy) {
        const tagData = this.tags.get(entityId);
        if (!tagData || tagData.isEnemy === isEnemy) return;

        tagData.isEnemy = isEnemy;
        const color = isEnemy ? '#ff6666' : '#ffffff';
        this._drawToCanvas(tagData.ctx, tagData.canvas, tagData.displayName, tagData.isDead, color);
        tagData.sprite.material.map.needsUpdate = true;
    }

    /**
     * Unregister an entity and cleanup its tag
     * @param {string} entityId
     */
    unregisterEntity(entityId) {
        const tagData = this.tags.get(entityId);
        if (!tagData) return;

        // Remove sprite from scene
        this.scene.remove(tagData.sprite);

        // Dispose resources
        if (tagData.sprite.material.map) {
            tagData.sprite.material.map.dispose();
        }
        tagData.sprite.material.dispose();

        this.tags.delete(entityId);
    }

    /**
     * Update visibility and positions of all tags based on player distance
     * Called once per server tick for visibility checks
     * @param {THREE.Vector3} playerPosition - Player position for distance check
     */
    updateVisibility(playerPosition) {
        for (const [entityId, tagData] of this.tags) {
            const { sprite, mesh } = tagData;

            // Skip if mesh no longer exists or not in scene
            if (!mesh || !mesh.parent) {
                sprite.visible = false;
                tagData.visible = false;
                continue;
            }

            // Get world position (handles nested objects correctly)
            mesh.getWorldPosition(this._worldPos);

            // Calculate squared distance from player (horizontal XZ only)
            const dx = playerPosition.x - this._worldPos.x;
            const dz = playerPosition.z - this._worldPos.z;
            const distSq = dx * dx + dz * dz;

            // Update visibility
            const shouldBeVisible = distSq <= this.VISIBILITY_DISTANCE_SQ;

            if (shouldBeVisible !== tagData.visible) {
                sprite.visible = shouldBeVisible;
                tagData.visible = shouldBeVisible;
            }

            // Update position if visible
            if (shouldBeVisible) {
                sprite.position.set(
                    this._worldPos.x,
                    this._worldPos.y + this.TAG_HEIGHT_OFFSET,
                    this._worldPos.z
                );
            }
        }
    }

    /**
     * Lightweight position update for visible tags only
     * Called every frame - getWorldPosition() is cheap for already-rendered objects
     */
    updatePositions() {
        for (const [entityId, tagData] of this.tags) {
            if (!tagData.visible) continue;

            const { sprite, mesh } = tagData;

            // Skip if mesh no longer exists
            if (!mesh || !mesh.parent) continue;

            // Update position
            mesh.getWorldPosition(this._worldPos);
            sprite.position.set(
                this._worldPos.x,
                this._worldPos.y + this.TAG_HEIGHT_OFFSET,
                this._worldPos.z
            );
        }
    }

    /**
     * Update mesh reference for an entity (useful when mesh is recreated)
     * @param {string} entityId
     * @param {THREE.Object3D} newMesh
     */
    updateEntityMesh(entityId, newMesh) {
        const tagData = this.tags.get(entityId);
        if (tagData) {
            tagData.mesh = newMesh;
        }
    }

    /**
     * Update display name for an existing entity (without needing mesh reference)
     * @param {string} entityId
     * @param {string} newDisplayName
     */
    updateEntityName(entityId, newDisplayName) {
        const tagData = this.tags.get(entityId);
        if (tagData && tagData.displayName !== newDisplayName) {
            this._updateSpriteText(tagData, newDisplayName, tagData.isDead);
        }
    }

    /**
     * Dispose all tags and cleanup
     */
    dispose() {
        // Collect IDs first to avoid modifying Map while iterating
        const entityIds = [...this.tags.keys()];
        for (const entityId of entityIds) {
            this.unregisterEntity(entityId);
        }
    }
}
