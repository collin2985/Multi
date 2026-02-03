
import { CONFIG } from '../config.js';
import { getTerrainGenerator } from '../core/TerrainAccess.js';

/**
 * AmbientSoundSystem
 * Manages environmental audio like ocean, plains, mountain, and campfire sounds.
 *
 * Sound zones (based on terrain Y height):
 * - Ocean: Y -30 to 10, with continent proximity check (no ocean sound inland)
 * - Plains: Y 0-22 (fade in 0→4, fade out 18→22)
 * - Mountain: Y 18+ (fade in 18→22, crossfades with plains)
 * - Campfire: Distance-based to active campfires
 */
export class AmbientSoundSystem {
    constructor(game) {
        this.game = game;
        this.gameState = game.gameState;
        // Note: game.playerObject might not be initialized yet, so we access it dynamically

        // Combat silence tracking - plains sound fades out during gunfights
        this.lastCombatTime = 0;
        this.combatSilenceDuration = 30000; // 30 seconds fade-in after combat ends
    }

    /**
     * Called when any gunshot occurs (player or AI)
     * Resets the combat silence timer
     */
    onCombatActivity() {
        this.lastCombatTime = Date.now();
    }

    update(deltaTime) {
        // Only update if audio system is initialized
        if (!this.game.audioManager || !this.game.audioManager.isInitialized) {
            return;
        }

        const deltaSeconds = deltaTime / 1000;

        this.updateOceanSound(deltaSeconds);
        this.updatePlainsSound(deltaSeconds);
        this.updateMountainSound(deltaSeconds);
        this.updateCampfireSound(deltaSeconds);
        this.updateBuildingFireSound(deltaSeconds);
    }

    /**
     * Update ocean ambient sound based on altitude and continent proximity
     * Ocean plays at Y -30 to 10, but only near ocean (not inland)
     * @param {number} deltaSeconds - Time delta in seconds
     */
    updateOceanSound(deltaSeconds) {
        if (!this.game.playerObject || !this.gameState.oceanSoundManager) {
            return;
        }

        const oceanManager = this.gameState.oceanSoundManager;
        const playerX = this.game.playerObject.position.x;
        const playerY = this.game.playerObject.position.y;
        const playerZ = this.game.playerObject.position.z;
        const maxVolume = CONFIG.AUDIO.OCEAN_SOUND_MAX_VOLUME;

        // Altitude factor: 100% at Y <= 4, fades from Y=4 to Y=10, 0% above Y=10
        let altitudeFactor = 1.0;
        const altitudeFullVolume = 4;
        const altitudeFadeEnd = 10;

        if (playerY > altitudeFadeEnd) {
            altitudeFactor = 0;
        } else if (playerY > altitudeFullVolume) {
            // Fade from 4 to 10
            const fadeRange = altitudeFadeEnd - altitudeFullVolume;
            altitudeFactor = 1.0 - (playerY - altitudeFullVolume) / fadeRange;
        }
        // Below Y=4, altitudeFactor stays at 1.0 (full volume down to -30)

        // Continent proximity factor: use terrain generator's continent mask
        // getContinentMask returns 1.0 for land, 0.0 for ocean
        let oceanInfluence = 1.0; // Default to full ocean if no terrain generator
        const terrainGenerator = getTerrainGenerator();
        if (terrainGenerator) {
            const continentMask = terrainGenerator.getContinentMask(playerX, playerZ);
            oceanInfluence = 1.0 - continentMask; // Invert: 0 = inland, 1 = ocean/coast
        }

        // Combined volume
        const targetVolume = altitudeFactor * oceanInfluence * maxVolume;

        // Start sound when volume is significant
        if (targetVolume > 0.01 && !oceanManager.isPlaying) {
            oceanManager.start();
        }

        // Always update if playing (let volume fade to 0 naturally)
        if (oceanManager.isPlaying) {
            oceanManager.update(deltaSeconds, targetVolume);
        }

        // Stop when completely silent (inland or high altitude)
        if (targetVolume < 0.001 && oceanManager.isPlaying) {
            oceanManager.stop();
        }
    }

    /**
     * Update plains ambient sound based on altitude
     * Plains plays at Y 0-22: fade in 0→4, full 4-18, fade out 18→22
     * @param {number} deltaSeconds - Time delta in seconds
     */
    updatePlainsSound(deltaSeconds) {
        if (!this.game.playerObject || !this.gameState.plainsSoundManager) {
            return;
        }

        const plainsManager = this.gameState.plainsSoundManager;
        const playerX = this.game.playerObject.position.x;
        const playerY = this.game.playerObject.position.y;
        const playerZ = this.game.playerObject.position.z;
        const maxVolume = CONFIG.AUDIO.PLAINS_SOUND_MAX_VOLUME;

        // Altitude-based volume
        // Fade in: Y 0→4, Full: Y 4-18, Fade out: Y 18→22
        const fadeInStart = 0;
        const fadeInEnd = 4;
        const fadeOutStart = 18;
        const fadeOutEnd = 22;

        let altitudeFactor = 0;

        if (playerY < fadeInStart || playerY > fadeOutEnd) {
            // Below 0 or above 22 - no sound
            altitudeFactor = 0;
        } else if (playerY < fadeInEnd) {
            // Fade in zone: 0 to 4
            altitudeFactor = (playerY - fadeInStart) / (fadeInEnd - fadeInStart);
        } else if (playerY <= fadeOutStart) {
            // Full volume zone: 4 to 18
            altitudeFactor = 1.0;
        } else {
            // Fade out zone: 18 to 22
            altitudeFactor = 1.0 - (playerY - fadeOutStart) / (fadeOutEnd - fadeOutStart);
        }

        // Only play on land - use continent mask
        let landFactor = 1.0;
        const terrainGenerator = getTerrainGenerator();
        if (terrainGenerator) {
            landFactor = terrainGenerator.getContinentMask(playerX, playerZ);
        }

        let targetVolume = altitudeFactor * landFactor * maxVolume;

        // Apply combat silence - fade out during gunfights, fade back in over 30 seconds
        if (this.lastCombatTime > 0) {
            const timeSinceCombat = Date.now() - this.lastCombatTime;
            if (timeSinceCombat < this.combatSilenceDuration) {
                // Fade progress: 0 at combat start, 1 after 30 seconds
                const fadeProgress = timeSinceCombat / this.combatSilenceDuration;
                targetVolume *= fadeProgress;
            }
        }

        // Start sound when volume is significant
        if (targetVolume > 0.01 && !plainsManager.isPlaying) {
            plainsManager.start();
        }

        // Always update if playing (let volume fade to 0 naturally)
        if (plainsManager.isPlaying) {
            plainsManager.update(deltaSeconds, targetVolume);
        }

        // Stop when completely silent
        if (targetVolume < 0.001 && plainsManager.isPlaying) {
            plainsManager.stop();
        }
    }

    /**
     * Update mountain ambient sound based on altitude
     * Mountain plays at Y 18+: fade in 18→22, full above 22
     * Crossfades with plains which fades out 18→22
     * @param {number} deltaSeconds - Time delta in seconds
     */
    updateMountainSound(deltaSeconds) {
        if (!this.game.playerObject || !this.gameState.mountainSoundManager) {
            return;
        }

        const mountainManager = this.gameState.mountainSoundManager;
        const playerX = this.game.playerObject.position.x;
        const playerY = this.game.playerObject.position.y;
        const playerZ = this.game.playerObject.position.z;
        const maxVolume = CONFIG.AUDIO.MOUNTAIN_SOUND_MAX_VOLUME;

        // Altitude-based volume
        // Fade in: Y 18→22, Full: Y 22+
        const fadeInStart = 18;
        const fadeInEnd = 22;

        let altitudeFactor = 0;

        if (playerY < fadeInStart) {
            // Below 18 - no sound
            altitudeFactor = 0;
        } else if (playerY >= fadeInEnd) {
            // Above 22 - full volume
            altitudeFactor = 1.0;
        } else {
            // Fade in zone: 18 to 22
            altitudeFactor = (playerY - fadeInStart) / (fadeInEnd - fadeInStart);
        }

        // Only play on land - use continent mask
        let landFactor = 1.0;
        const terrainGenerator = getTerrainGenerator();
        if (terrainGenerator) {
            landFactor = terrainGenerator.getContinentMask(playerX, playerZ);
        }

        const targetVolume = altitudeFactor * landFactor * maxVolume;

        // Start sound when volume is significant
        if (targetVolume > 0.01 && !mountainManager.isPlaying) {
            mountainManager.start();
        }

        // Always update if playing (let volume fade to 0 naturally)
        if (mountainManager.isPlaying) {
            mountainManager.update(deltaSeconds, targetVolume);
        }

        // Stop when completely silent
        if (targetVolume < 0.001 && mountainManager.isPlaying) {
            mountainManager.stop();
        }
    }

    /**
     * Update campfire ambient sound based on distance to nearest active campfire
     * @param {number} deltaSeconds - Time delta in seconds
     */
    updateCampfireSound(deltaSeconds) {
        if (!this.game.playerObject || !this.gameState.campfireSoundManager) {
            return;
        }

        const campfireManager = this.gameState.campfireSoundManager;
        const playerPos = this.game.playerObject.position;

        // Find nearest active campfire
        let nearestDistance = Infinity;

        // Access smokeEffects from EffectManager
        if (this.game.effectManager && this.game.effectManager.smokeEffects) {
            for (const [objectId, smokeEffect] of this.game.effectManager.smokeEffects.entries()) {
                // Only consider campfires with active smoke (burning firewood)
                if (!smokeEffect.active) continue;

                // Find the campfire object in the scene
                const campfireObject = this.game.scene.children.find(obj =>
                    obj.userData.objectId === objectId
                );

                if (campfireObject) {
                    // Calculate 3D distance from player to campfire
                    const dx = playerPos.x - campfireObject.position.x;
                    const dy = playerPos.y - campfireObject.position.y;
                    const dz = playerPos.z - campfireObject.position.z;
                    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                    }
                }
            }
        }

        // Calculate volume based on nearest campfire distance
        const minDistance = CONFIG.AUDIO.CAMPFIRE_SOUND_MIN_DISTANCE; // 1 unit
        const maxDistance = CONFIG.AUDIO.CAMPFIRE_SOUND_MAX_DISTANCE; // 7 units
        const maxVolume = CONFIG.AUDIO.CAMPFIRE_SOUND_MAX_VOLUME; // 0.2

        let targetVolume = 0;

        if (nearestDistance <= minDistance) {
            // Within minimum distance - full volume
            targetVolume = maxVolume;
        } else if (nearestDistance >= maxDistance) {
            // Beyond maximum distance - no sound
            targetVolume = 0;
        } else {
            // Linear interpolation between min and max distance
            const fadeRange = maxDistance - minDistance; // 7 - 1 = 6
            const fadeProgress = 1.0 - ((nearestDistance - minDistance) / fadeRange);
            targetVolume = maxVolume * fadeProgress;
        }

        // Start sound when near an active campfire
        if (targetVolume > 0 && !campfireManager.isPlaying) {
            campfireManager.start();
        }

        // Always update if playing (let volume fade to 0 naturally)
        if (campfireManager.isPlaying) {
            campfireManager.update(deltaSeconds, targetVolume);
        }

        // Stop when no active campfires nearby
        if (nearestDistance > maxDistance + 1.0 && campfireManager.isPlaying) {
            campfireManager.stop();
        }
    }

    /**
     * Update building fire ambient sound based on distance to nearest dying structure
     * @param {number} deltaSeconds - Time delta in seconds
     */
    updateBuildingFireSound(deltaSeconds) {
        if (!this.game.playerObject || !this.gameState.buildingFireSoundManager) {
            return;
        }

        const manager = this.gameState.buildingFireSoundManager;
        const playerPos = this.game.playerObject.position;

        // Find nearest dying structure
        let nearestDistance = Infinity;

        if (this.game.effectManager?.dyingStructures) {
            for (const objectId of this.game.effectManager.dyingStructures) {
                const obj = this.game.objectRegistry?.get(objectId);
                if (obj) {
                    const dx = playerPos.x - obj.position.x;
                    const dy = playerPos.y - obj.position.y;
                    const dz = playerPos.z - obj.position.z;
                    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                    }
                }
            }
        }

        // Volume settings for building fire (slightly louder/farther range than campfire)
        const minDistance = 1;   // Full volume at 1 unit
        const maxDistance = 15;  // Silent at 15 units
        const maxVolume = 0.3;   // Slightly louder than campfire (0.2)

        let targetVolume = 0;

        if (nearestDistance <= minDistance) {
            targetVolume = maxVolume;
        } else if (nearestDistance >= maxDistance) {
            targetVolume = 0;
        } else {
            const fadeRange = maxDistance - minDistance;
            const fadeProgress = 1.0 - ((nearestDistance - minDistance) / fadeRange);
            targetVolume = maxVolume * fadeProgress;
        }

        // Start sound when near a dying structure
        if (targetVolume > 0 && !manager.isPlaying) {
            manager.start();
        }

        // Always update if playing
        if (manager.isPlaying) {
            manager.update(deltaSeconds, targetVolume);
        }

        // Stop when no dying structures nearby
        if (nearestDistance > maxDistance + 1.0 && manager.isPlaying) {
            manager.stop();
        }
    }
}
