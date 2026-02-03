/**
 * AvatarManager.js
 * Manages peer player avatars - creation, movement, animations, death
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../config.js';
import { MuzzleFlash } from '../effects/MuzzleFlash.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { applyEuclideanFog } from '../objects.js';

export class AvatarManager {
    constructor(scene, networkManager, structureManager, terrainGenerator, modelManager, navigationManager = null, playerScale = 1) {
        this.scene = scene;
        this.networkManager = networkManager;
        this.structureManager = structureManager;
        this.terrainGenerator = terrainGenerator;
        this.modelManager = modelManager;
        this.navigationManager = navigationManager;
        this.camera = null; // Set via setCamera() for LOD calculations

        this.playerScale = playerScale; // Use the same scale as main player
        this.playerSpeed = 0.000625; // Base speed (matches PlayerController)
        this.stopThreshold = 0.01;

        // Frame counter for periodic updates (height, LOD, combat stance)
        this.frameCounter = 0;

        // Combat stance cache (updated every N frames to reduce AI enemy distance checks)
        this.combatStanceCache = new Map(); // peerId -> { inCombat: boolean, lastUpdate: number }
        this.COMBAT_CHECK_INTERVAL = 10; // Check combat stance every 10 frames (6 times per second at 60 FPS)

        // PERFORMANCE: Distance thresholds for LOD (squared to avoid sqrt)
        this.LOD_DISTANCE_FAR_SQ = 2500;    // > 50 units: minimal updates
        this.LOD_DISTANCE_MED_SQ = 625;     // > 25 units: reduced updates
        this.LOD_PHYSICS_DISTANCE_SQ = 400; // > 20 units: skip physics

        // Terrain height update interval (using getHeightFast instead of raycasting)
        this.HEIGHT_UPDATE_INTERVAL = 4; // Update Y position every 4 frames (was 10)

        // Effect manager reference (set via setEffectManager)
        this.effectManager = null;

        // PERFORMANCE: Reusable vectors to avoid GC pressure (pooled objects)
        this._tempNextPosition = new THREE.Vector3();
        this._tempDirection = new THREE.Vector3();

        // PERFORMANCE: Pre-computed squared thresholds
        this.stopThresholdSq = this.stopThreshold * this.stopThreshold;
    }

    /**
     * Set camera reference for LOD calculations
     * @param {THREE.Camera} camera
     */
    setCamera(camera) {
        this.camera = camera;
    }

    /**
     * Set effect manager reference for gunsmoke effects
     * @param {EffectManager} effectManager
     */
    setEffectManager(effectManager) {
        this.effectManager = effectManager;
    }

    /**
     * Create a new avatar for a peer player
     * @returns {THREE.Object3D|null}
     */
    createAvatar() {
        const manGLTF = this.modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error('Man model not loaded for avatar');
            return null;
        }

        // Use SkeletonUtils.clone() to preserve skeleton binding for animations
        const avatarMesh = SkeletonUtils.clone(manGLTF.scene);
        avatarMesh.scale.set(this.playerScale, this.playerScale, this.playerScale);

        // Setup materials (same as main player)
        avatarMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = true;  // PERFORMANCE: Enable frustum culling to skip off-screen rendering
                child.renderOrder = 1;

                if (child.material) {
                    child.material.depthWrite = true;
                    child.material.depthTest = true;
                    if (child.material.type === 'MeshStandardMaterial') {
                        applyEuclideanFog(child.material);
                        child.material.needsUpdate = true;
                    }
                }

                // Store shirt mesh reference for faction coloring
                if (child.name === 'Cube001_3' && child.material) {
                    child.material = child.material.clone();
                    child.material.color.setHex(CONFIG.FACTION_COLORS.default.shirt); // Default gray
                    applyEuclideanFog(child.material);
                    avatarMesh.userData.shirtMesh = child;
                }
            }
        });

        // Create animation mixer for this avatar
        if (manGLTF.animations && manGLTF.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(avatarMesh);

            // Load walk animation
            const walkAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('walk')
            );

            // Load combat animation
            const combatAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('combat')
            );

            // Load pickaxe/chopping animation (used for all harvest actions)
            const choppingAnimation = manGLTF.animations.find(anim => {
                const name = anim.name.toLowerCase();
                // Check for exact matches first
                if (name === 'pickaxe' || name === 'pickaxe.001' || name === 'armature|pickaxe') {
                    return true;
                }
                // Then check for partial matches
                return name.includes('pickaxe') || name.includes('pick') ||
                       name.includes('axe') || name.includes('action');
            });

            // Load idle animation
            const idleAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('idle')
            );

            // Store mixer in userData
            avatarMesh.userData.mixer = mixer;

            if (walkAnimation) {
                const walkAction = mixer.clipAction(walkAnimation);
                avatarMesh.userData.walkAction = walkAction;
            }

            if (idleAnimation) {
                const idleAction = mixer.clipAction(idleAnimation);
                idleAction.loop = THREE.LoopRepeat;
                idleAction.play(); // Start in idle
                avatarMesh.userData.idleAction = idleAction;
            } else if (walkAnimation) {
                // Fallback: start walk if no idle
                avatarMesh.userData.walkAction.play();
            }

            if (combatAnimation) {
                const combatAction = mixer.clipAction(combatAnimation);
                avatarMesh.userData.combatAction = combatAction;
            }

            if (choppingAnimation) {
                const choppingAction = mixer.clipAction(choppingAnimation);
                choppingAction.loop = THREE.LoopRepeat;
                avatarMesh.userData.choppingAction = choppingAction;
            }

            // Load shoot animation
            const shootAnimation = manGLTF.animations.find(anim => {
                const name = anim.name.toLowerCase();
                return name.includes('shoot') || name.includes('fire') ||
                       name.includes('rifle') || name.includes('gun') ||
                       name.includes('aim');
            });

            if (shootAnimation) {
                const shootAction = mixer.clipAction(shootAnimation);
                shootAction.loop = THREE.LoopOnce;
                shootAction.clampWhenFinished = true;
                avatarMesh.userData.shootAction = shootAction;
            }
        }

        // Attach rifle to peer's hand
        const rifleModel = this.modelManager.getModel('rifle');
        if (rifleModel) {
            const rifleMesh = rifleModel.clone();

            // Find Bone014 (hand bone) in the avatar skeleton
            let handBone = null;
            avatarMesh.traverse((child) => {
                if (child.isBone && child.name === 'Bone014') {
                    handBone = child;
                }
            });

            if (handBone) {
                // Set rifle position, scale, and rotation (finalized values)
                rifleMesh.position.set(0.33, 1.8, 0.33);
                rifleMesh.scale.set(21.4, 23.9, 14);
                rifleMesh.rotation.set(-1.26, -0.02, 0.82);

                // Set rifle material to black
                rifleMesh.traverse((child) => {
                    if (child.isMesh) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0x000000,
                            metalness: 0.7,
                            roughness: 0.3
                        });
                        applyEuclideanFog(child.material);
                    }
                });

                // Attach rifle to hand bone
                handBone.add(rifleMesh);
                rifleMesh.visible = false; // Start hidden - shown only when peer has rifle and is in combat
                avatarMesh.userData.rifle = rifleMesh;

                // Create muzzle flash for peer's rifle
                const muzzleFlash = new MuzzleFlash();
                muzzleFlash.attachTo(rifleMesh);
                avatarMesh.userData.muzzleFlash = muzzleFlash;
            } else {
                console.warn('[PEER] Could not find Bone014 for rifle attachment');
            }
        }

        // Store last position for rotation calculation
        avatarMesh.userData.lastPosition = new THREE.Vector3();
        avatarMesh.userData.isMoving = false;

        // Note: Character controller will be created when avatar is added to scene with objectId

        return avatarMesh;
    }

    /**
     * Create physics character controller for peer avatar
     * @param {THREE.Object3D} avatar - Avatar mesh
     * @param {string} peerId - Peer client ID
     */
    createAvatarPhysics(avatar, peerId) {
        const game = this.networkManager.game;
        if (game && game.physicsManager && game.physicsManager.initialized) {
            const avatarObjectId = `peer_${peerId}`;
            avatar.userData.objectId = avatarObjectId;

            // Create character controller (radius: 0.3, height: 1.0)
            game.physicsManager.createCharacterController(
                avatarObjectId,
                0.3,  // Capsule radius
                1.0,  // Capsule height
                avatar.position
            );
        }
    }

    /**
     * Update all avatar movements and animations
     * @param {number} deltaTime
     */
    updateAvatarMovement(deltaTime) {
        this.frameCounter++;
        const shouldUpdateHeight = (this.frameCounter % this.HEIGHT_UPDATE_INTERVAL === 0);

        // Get camera position once for all LOD calculations
        const cameraPos = this.camera?.position;

        this.networkManager.avatars.forEach((avatar, peerId) => {
            const peer = this.networkManager.peerGameData.get(peerId);

            // Skip position updates for dead avatars (prevents position updates from interfering with death animation)
            if (avatar.userData.isDead) {
                return;
            }

            // PERFORMANCE: Calculate distance to camera for LOD (squared to avoid sqrt)
            let distToCameraSq = 0;
            if (cameraPos) {
                const dx = avatar.position.x - cameraPos.x;
                const dz = avatar.position.z - cameraPos.z;
                distToCameraSq = dx * dx + dz * dz;
            }

            // Store LOD level in avatar for animation system to use
            avatar.userData.lodLevel = distToCameraSq > this.LOD_DISTANCE_FAR_SQ ? 2 :
                                       distToCameraSq > this.LOD_DISTANCE_MED_SQ ? 1 : 0;

            // TARGET CHASING SYSTEM (skip if peer is piloting or climbing)
            const target = peer?.targetPosition;
            const lastUpdateTime = peer?.lastUpdateTime;
            const isPilotingVehicle = peer?.isPiloting && peer?.mobileEntity;

            if (target && !isPilotingVehicle && !peer?.isClimbing) {
                // Store last position for rotation calculation
                avatar.userData.lastPosition.copy(avatar.position);

                const now = Date.now();
                const timeSinceUpdate = now - (lastUpdateTime || now);
                const expectedArrival = CONFIG.PEER_AVATAR.UPDATE_INTERVAL;
                const timeRemaining = Math.max(expectedArrival - timeSinceUpdate, 16); // Min 16ms

                // Calculate distance (XZ only, Y handled separately)
                const dx = target.x - avatar.position.x;
                const dz = target.z - avatar.position.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                // Use peer's synced movement state when recent, otherwise derive from distance
                const isRecentUpdate = (now - (lastUpdateTime || 0)) < 1000;
                const peerActuallyMoving = peer?.peerIsMoving ?? false;

                if (distance > CONFIG.PEER_AVATAR.SNAP_THRESHOLD) {
                    // Teleport case (spawn, large desync)
                    avatar.position.x = target.x;
                    avatar.position.z = target.z;
                    avatar.rotation.y = peer.targetRotation || avatar.rotation.y;
                    avatar.userData.isMoving = false;
                } else if (distance > CONFIG.PEER_AVATAR.STOP_THRESHOLD) {
                    // Walk toward target
                    const speed = Math.min(distance / timeRemaining, CONFIG.PEER_AVATAR.MAX_SPEED);
                    const step = speed * deltaTime;
                    const alpha = Math.min(step / distance, 1);

                    avatar.position.x += dx * alpha;
                    avatar.position.z += dz * alpha;
                    // Use peer's actual movement state for animation accuracy
                    avatar.userData.isMoving = isRecentUpdate ? peerActuallyMoving : true;

                    // Smoothly rotate toward movement direction
                    if (distance > 0.5) {
                        const targetRot = Math.atan2(dx, dz);
                        avatar.rotation.y = this.lerpAngle(avatar.rotation.y, targetRot, 0.25);
                    }
                } else {
                    // Close enough - use peer's actual state or stop
                    avatar.userData.isMoving = isRecentUpdate ? peerActuallyMoving : false;
                    if (peer.targetRotation !== undefined) {
                        avatar.rotation.y = this.lerpAngle(avatar.rotation.y, peer.targetRotation, 0.25);
                    }
                }

                // PERFORMANCE: Update Y using terrain height (includes docks via leveled areas)
                if (!peer.isClimbing) {
                    if (shouldUpdateHeight && this.terrainGenerator) {
                        const terrainY = this.terrainGenerator.getWorldHeight(avatar.position.x, avatar.position.z);
                        if (terrainY !== undefined && terrainY !== null) {
                            peer.targetY = terrainY + 0.03;
                        }
                    }

                    // Lerp to target Y every frame for smooth transitions
                    if (peer.targetY !== undefined) {
                        avatar.position.y = THREE.MathUtils.lerp(avatar.position.y, peer.targetY, 0.35);
                    }
                }
            }

            // Check if peer is climbing and update climbing animation
            if (peer?.isClimbing && peer.climbingTargetPosition) {
                // Lerp to climbing target position (center of outpost + 2 units up)
                avatar.position.lerp(peer.climbingTargetPosition, 0.2);

                // Stop movement animation when climbing
                if (avatar.userData.walkAction && avatar.userData.walkAction.isRunning()) {
                    avatar.userData.walkAction.stop();
                }
            }

            // Handle peer boarding animation - lerp from ground to vehicle (Issues #5, #13)
            if (peer?.vehiclePhase === 'boarding' && peer.boardingStartPosition && peer.mobileEntity) {
                const elapsed = Date.now() - (peer.boardingStartTime || Date.now());
                const duration = peer.boardingDuration || 500;
                const progress = Math.min(1.0, elapsed / duration);

                const game = this.networkManager.game;
                const entityType = peer.mobileEntity.entityType || 'boat';
                const config = game?.mobileEntitySystem?.getConfig(entityType);
                const playerYOffset = config?.playerYOffset || (entityType === 'horse' ? 1.0 : -0.1);

                // Calculate target position on vehicle
                const vehiclePos = peer.mobileEntity.mesh?.position || peer.mobileEntity.position;
                const vehicleRot = peer.mobileEntity.mesh?.rotation.y ?? peer.mobileEntity.rotation ?? 0;
                let targetX = vehiclePos.x;
                let targetZ = vehiclePos.z;
                if (config?.playerZOffset) {
                    targetX += Math.sin(vehicleRot) * config.playerZOffset;
                    targetZ += Math.cos(vehicleRot) * config.playerZOffset;
                }
                if (config?.playerForwardOffset) {
                    targetX += Math.sin(vehicleRot) * config.playerForwardOffset;
                    targetZ += Math.cos(vehicleRot) * config.playerForwardOffset;
                }
                const targetY = vehiclePos.y + playerYOffset;

                // Lerp avatar from start position to vehicle
                avatar.position.x = peer.boardingStartPosition.x + (targetX - peer.boardingStartPosition.x) * progress;
                avatar.position.y = peer.boardingStartPosition.y + (targetY - peer.boardingStartPosition.y) * progress;
                avatar.position.z = peer.boardingStartPosition.z + (targetZ - peer.boardingStartPosition.z) * progress;
                avatar.rotation.y = vehicleRot;

                // Play walk animation during boarding
                if (avatar.userData.walkAction && !avatar.userData.walkAction.isRunning()) {
                    avatar.userData.walkAction.play();
                }
                avatar.userData.isMoving = true;
            }

            // Handle peer disembarking animation - lerp from vehicle to ground (Issues #44, #45)
            if (peer?.vehiclePhase === 'disembarking' && peer.disembarkStartPosition && peer.disembarkTargetPosition) {
                const elapsed = Date.now() - (peer.disembarkStartTime || Date.now());
                const duration = peer.disembarkDuration || 500;
                const progress = Math.min(1.0, elapsed / duration);

                // Lerp avatar from vehicle to target ground position
                avatar.position.lerpVectors(peer.disembarkStartPosition, peer.disembarkTargetPosition, progress);

                // Face toward target
                const dx = peer.disembarkTargetPosition.x - peer.disembarkStartPosition.x;
                const dz = peer.disembarkTargetPosition.z - peer.disembarkStartPosition.z;
                if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
                    avatar.rotation.y = Math.atan2(dx, dz);
                }

                // Play walk animation during disembarking
                if (avatar.userData.walkAction && !avatar.userData.walkAction.isRunning()) {
                    avatar.userData.walkAction.play();
                }
                avatar.userData.isMoving = true;
            }

            // Check if peer is piloting a mobile entity (boat/cart/horse)
            if (peer?.isPiloting && peer.mobileEntity) {
                const game = this.networkManager.game;
                const entityType = peer.mobileEntity.entityType || 'boat';
                const config = game?.mobileEntitySystem?.getConfig(entityType);
                const playerYOffset = config?.playerYOffset || (entityType === 'horse' ? 1.0 : -0.1);
                const mesh = peer.mobileEntity.mesh;

                // Lerp mesh toward target position/rotation for smooth movement
                if (mesh && peer.mobileEntity.targetPosition) {
                    // Lerp position (0.2 = smooth but responsive)
                    mesh.position.lerp(peer.mobileEntity.targetPosition, 0.2);

                    // Lerp rotation with angle wrapping to avoid spinning the long way
                    const currentRot = mesh.rotation.y;
                    const targetRot = peer.mobileEntity.targetRotation;
                    mesh.rotation.y = this.lerpAngle(currentRot, targetRot, 0.2);

                    // Entity-specific Y handling
                    if (entityType === 'horse' && this.terrainGenerator) {
                        // Horse Y follows terrain
                        const terrainY = this.terrainGenerator.getWorldHeight(mesh.position.x, mesh.position.z) || 0;
                        mesh.position.y = terrainY;
                    }
                    // Boats: Y handled by AnimationSystem (wave height)

                    // Update kinematic collider position and rotation for peer boats (enables collision with local player's boat)
                    if (game?.physicsManager && mesh.userData?.physicsBodyId) {
                        game.physicsManager.updateKinematicPosition(mesh.userData.physicsBodyId, mesh.position);
                        game.physicsManager.updateKinematicRotation(mesh.userData.physicsBodyId, mesh.rotation.y);
                    }

                    // Attach avatar to the lerped entity position with proper helm offsets
                    const heading = mesh.rotation.y;
                    let avatarX = mesh.position.x;
                    let avatarZ = mesh.position.z;

                    // Apply helm position offsets (same as local player uses)
                    if (config?.playerZOffset) {
                        avatarX += Math.sin(heading) * config.playerZOffset;
                        avatarZ += Math.cos(heading) * config.playerZOffset;
                    }
                    if (config?.playerForwardOffset) {
                        avatarX += Math.sin(heading) * config.playerForwardOffset;
                        avatarZ += Math.cos(heading) * config.playerForwardOffset;
                    }

                    avatar.position.set(
                        avatarX,
                        mesh.position.y + playerYOffset,
                        avatarZ
                    );
                    // Set full rotation (not just Y) to prevent sideways character bug
                    // Also reset child mesh rotation in case of leftover death animation
                    avatar.rotation.set(0, mesh.rotation.y, 0);
                    if (avatar.children[0]) {
                        avatar.children[0].rotation.set(0, 0, 0);
                    }

                    // Update horse animation based on movement
                    if (entityType === 'horse') {
                        this.updatePeerHorseAnimation(peer, deltaTime);
                    }
                } else {
                    // Fallback: no mesh, use stored position directly
                    const mobilePos = peer.mobileEntity.position;
                    const mobileRot = peer.mobileEntity.rotation;

                    // Apply helm position offsets (same as mesh path)
                    let avatarX = mobilePos.x;
                    let avatarZ = mobilePos.z;
                    if (config?.playerZOffset) {
                        avatarX += Math.sin(mobileRot) * config.playerZOffset;
                        avatarZ += Math.cos(mobileRot) * config.playerZOffset;
                    }
                    if (config?.playerForwardOffset) {
                        avatarX += Math.sin(mobileRot) * config.playerForwardOffset;
                        avatarZ += Math.cos(mobileRot) * config.playerForwardOffset;
                    }

                    avatar.position.set(avatarX, mobilePos.y + playerYOffset, avatarZ);
                    // Set full rotation to prevent sideways character bug
                    avatar.rotation.set(0, mobileRot, 0);
                    if (avatar.children[0]) {
                        avatar.children[0].rotation.set(0, 0, 0);
                    }
                }

                // Stop movement animations - peer is stationary on their vehicle
                if (avatar.userData.walkAction && avatar.userData.walkAction.isRunning()) {
                    avatar.userData.walkAction.stop();
                }
                if (avatar.userData.idleAction && !avatar.userData.idleAction.isRunning()) {
                    avatar.userData.idleAction.play();
                }
                avatar.userData.isMoving = false;
            }

            // Handle peers manning ship artillery (gunners)
            // Position at cannon slot - runs after isPiloting block to override helm position
            if (peer?.mannedArtillery?.isShipMounted && peer.mannedArtillery.shipId) {
                const game = this.networkManager.game;
                const gameStateManager = game?.gameStateManager;
                const shipId = peer.mannedArtillery.shipId;
                const artilleryId = peer.mannedArtillery.artilleryId;

                // Use helper to find ship mesh (fixes bug where external gunners lack mobileEntity)
                const shipMesh = gameStateManager
                    ? gameStateManager.getShipMeshForGunner(shipId, peer)
                    : (peer.mobileEntity?.mesh || game?.objectRegistry?.get(shipId));

                if (shipMesh) {
                    // Use helper to find artillery data from pilot peer (fixes bug where loadedArtillery is on pilot's peerData)
                    const artilleryData = gameStateManager
                        ? gameStateManager.getShipArtilleryData(shipId, artilleryId, peer)
                        : peer.loadedArtillery?.find(a => a.artilleryId === artilleryId);

                    if (artilleryData?.mesh) {
                        // Use artillery mesh world position (accounts for ship position + rotation + slot offset)
                        const artilleryWorldPos = new THREE.Vector3();
                        artilleryData.mesh.getWorldPosition(artilleryWorldPos);
                        avatar.position.copy(artilleryWorldPos);
                    } else {
                        // Fallback: Calculate from slot config + ship transform using proper 3D transformation
                        const slotIndex = peer.mannedArtillery.slotIndex ?? 0;
                        const slotConfig = CONFIG.CRATE_VEHICLES?.ship2_artillery?.slots?.[slotIndex];

                        if (slotConfig) {
                            // Use proper 3D vector transformation (fixes Bug #8)
                            const localOffset = new THREE.Vector3(slotConfig.x, slotConfig.y, slotConfig.z);
                            localOffset.applyQuaternion(shipMesh.quaternion);
                            avatar.position.copy(shipMesh.position).add(localOffset);
                        } else {
                            // Last resort fallback - use slot Y offset
                            avatar.position.set(shipMesh.position.x, shipMesh.position.y + 0.8, shipMesh.position.z);
                        }
                    }

                    // Face same direction as ship
                    avatar.rotation.set(0, shipMesh.rotation.y, 0);
                    if (avatar.children[0]) {
                        avatar.children[0].rotation.set(0, 0, 0);
                    }
                    // Stop movement animations - peer is stationary at gun position
                    if (avatar.userData.walkAction && avatar.userData.walkAction.isRunning()) {
                        avatar.userData.walkAction.stop();
                    }
                    if (avatar.userData.idleAction && !avatar.userData.idleAction.isRunning()) {
                        avatar.userData.idleAction.play();
                    }
                    avatar.userData.isMoving = false;
                }
            }

            // Fallback: Peer is on a ship (has mobileEntity) but not actively piloting and not manning artillery
            // This handles edge cases where peer state transitions left them without proper position updates
            if (peer?.mobileEntity?.mesh && !peer.isPiloting && !peer.mannedArtillery?.isShipMounted) {
                const mesh = peer.mobileEntity.mesh;
                const entityType = peer.mobileEntity.entityType || 'boat';
                const config = this.networkManager.game?.mobileEntitySystem?.getConfig(entityType);
                const playerYOffset = config?.playerYOffset || -0.1;

                avatar.position.set(
                    mesh.position.x,
                    mesh.position.y + playerYOffset,
                    mesh.position.z
                );
                avatar.rotation.set(0, mesh.rotation.y, 0);
                if (avatar.children[0]) {
                    avatar.children[0].rotation.set(0, 0, 0);
                }
            }

            // Lerp peer's towed cart (if they're towing one)
            if (peer?.towedCart && peer.towedCart.mesh) {
                const cartMesh = peer.towedCart.mesh;
                const cartTarget = peer.towedCart.targetPosition;
                const cartTargetRot = peer.towedCart.targetRotation;

                if (cartTarget) {
                    // Lerp cart position (0.15 = smooth following)
                    cartMesh.position.lerp(cartTarget, 0.15);

                    // Lerp rotation with angle wrapping
                    if (cartTargetRot !== undefined) {
                        cartMesh.rotation.y = this.lerpAngle(cartMesh.rotation.y, cartTargetRot, 0.15);
                    }

                    // Update Y to follow terrain
                    if (this.terrainGenerator) {
                        const cartTerrainY = this.terrainGenerator.getWorldHeight(cartMesh.position.x, cartMesh.position.z);
                        if (cartTerrainY !== undefined) {
                            cartMesh.position.y = cartTerrainY;
                        }
                    }

                    // If there's a crate on the cart, update its position too
                    if (peer.towedCart.loadedCrate && peer.towedCart.loadedCrate.mesh) {
                        const crateMesh = peer.towedCart.loadedCrate.mesh;
                        const CART_HEIGHT = 0.2;  // CONFIG.CRATE_CART.CART_HEIGHT_OFFSET
                        const CART_Z = -0.1;      // CONFIG.CRATE_CART.CART_Z_OFFSET

                        // Position crate on cart
                        const cartDir = new THREE.Vector3(
                            Math.sin(cartMesh.rotation.y),
                            0,
                            Math.cos(cartMesh.rotation.y)
                        );
                        crateMesh.position.set(
                            cartMesh.position.x + cartDir.x * CART_Z,
                            cartMesh.position.y + CART_HEIGHT,
                            cartMesh.position.z + cartDir.z * CART_Z
                        );
                        crateMesh.rotation.y = cartMesh.rotation.y;
                    }
                }
            }

            // Lerp peer's towed artillery (if they're towing one)
            if (peer?.towedArtillery && peer.towedArtillery.mesh) {
                const artilleryMesh = peer.towedArtillery.mesh;
                const artilleryTarget = peer.towedArtillery.targetPosition;
                const artilleryTargetRot = peer.towedArtillery.targetRotation;

                if (artilleryTarget) {
                    // Lerp artillery position (0.15 = smooth following)
                    artilleryMesh.position.lerp(artilleryTarget, 0.15);

                    // Lerp rotation with angle wrapping
                    if (artilleryTargetRot !== undefined) {
                        artilleryMesh.rotation.y = this.lerpAngle(artilleryMesh.rotation.y, artilleryTargetRot, 0.15);
                    }

                    // Update Y to follow terrain
                    if (this.terrainGenerator) {
                        const artilleryTerrainY = this.terrainGenerator.getWorldHeight(artilleryMesh.position.x, artilleryMesh.position.z);
                        if (artilleryTerrainY !== undefined) {
                            artilleryMesh.position.y = artilleryTerrainY;
                        }
                    }
                }
            }

            // Check if peer is harvesting and update harvest animation
            if (peer?.harvestState) {
                const now = Date.now();
                if (now >= peer.harvestState.endTime) {
                    // Harvest complete, stop chopping animation
                    if (peer.choppingAction) {
                        peer.choppingAction.stop();
                    }
                    peer.harvestState = null;
                }
            }

            // PERFORMANCE: LOD-based animation updates
            // LOD 0 (close): update every frame
            // LOD 1 (medium): update every 3 frames
            // LOD 2 (far): update every 10 frames
            const lodLevel = avatar.userData.lodLevel || 0;
            const shouldUpdateAnimation = lodLevel === 0 ||
                                         (lodLevel === 1 && this.frameCounter % 3 === 0) ||
                                         (lodLevel === 2 && this.frameCounter % 10 === 0);

            // Update animation mixer
            if (avatar.userData.mixer && shouldUpdateAnimation) {
                // Calculate time multiplier for LOD (compensate for skipped frames)
                const lodTimeMultiplier = lodLevel === 0 ? 1 : (lodLevel === 1 ? 3 : 10);

                // If peer is harvesting, only play chopping animation
                if (peer?.harvestState) {
                    // Stop walk/combat/idle animations during harvest
                    if (avatar.userData.walkAction && avatar.userData.walkAction.isRunning()) {
                        avatar.userData.walkAction.stop();
                    }
                    if (avatar.userData.combatAction && avatar.userData.combatAction.isRunning()) {
                        avatar.userData.combatAction.stop();
                    }
                    if (avatar.userData.idleAction && avatar.userData.idleAction.isRunning()) {
                        avatar.userData.idleAction.stop();
                    }

                    // Hide rifle during harvesting (can't harvest while holding rifle)
                    if (avatar.userData.rifle) {
                        avatar.userData.rifle.visible = false;
                    }

                    // Update mixer to advance chopping animation at same speed as main player
                    avatar.userData.mixer.update((deltaTime / 1000) * 0.375 * lodTimeMultiplier);
                } else {
                    // Not harvesting - handle walk/combat animations normally
                    // Use synced combat state from peer (authoritative - includes both inCombat and hasRifle checks)
                    const showCombatAnimation = peer?.showCombatAnimation || false;

                    if (showCombatAnimation && avatar.userData.combatAction) {
                        // Show rifle in combat stance
                        if (avatar.userData.rifle) {
                            avatar.userData.rifle.visible = true;
                        }

                        // Combat stance: stop walk/idle animations
                        if (avatar.userData.walkAction && avatar.userData.walkAction.isRunning()) {
                            avatar.userData.walkAction.stop();
                        }
                        if (avatar.userData.idleAction && avatar.userData.idleAction.isRunning()) {
                            avatar.userData.idleAction.stop();
                        }

                        if (avatar.userData.isMoving) {
                            // Combat movement: loop combat animation, scaled with movement speed
                            if (avatar.userData.combatAction) {
                                avatar.userData.combatAction.paused = false;
                                if (!avatar.userData.combatAction.isRunning()) {
                                    avatar.userData.combatAction.play();
                                }
                            }
                            // Use peer's speed multiplier for animation (slope affects both movement and animation)
                            // Base walk animation speed increased by 25%
                            const peerAnimSpeed = peer?.speedMultiplier ?? 1.0;
                            avatar.userData.mixer.update((deltaTime / 1000) * peerAnimSpeed * 1.25 * lodTimeMultiplier);
                        } else {
                            // Combat idle: freeze combat animation at frame 2
                            if (avatar.userData.combatAction) {
                                avatar.userData.combatAction.reset();
                                const frameTime = 2 / 24;  // Frame 2 at 24fps
                                avatar.userData.combatAction.time = frameTime;
                                avatar.userData.combatAction.weight = 1.0;
                                avatar.userData.combatAction.play();
                                avatar.userData.combatAction.paused = true;
                                // Update mixer once to apply the pose (prevents T-pose)
                                avatar.userData.mixer.update(0.001);
                            }
                        }
                    } else {
                        // Hide rifle when not in combat
                        if (avatar.userData.rifle) {
                            avatar.userData.rifle.visible = false;
                        }

                        // Normal state: stop combat animation and use walk
                        if (avatar.userData.combatAction && (avatar.userData.combatAction.isRunning() || avatar.userData.combatAction.paused)) {
                            avatar.userData.combatAction.stop();
                            avatar.userData.combatAction.reset();
                        }

                        if (avatar.userData.isMoving) {
                            // Play walk animation when moving
                            if (avatar.userData.idleAction && avatar.userData.idleAction.isRunning()) {
                                avatar.userData.idleAction.stop();
                            }
                            if (avatar.userData.walkAction && !avatar.userData.walkAction.isRunning()) {
                                avatar.userData.walkAction.play();
                            }
                            // Use peer's speed multiplier for animation (slope affects both movement and animation)
                            // Base walk animation speed increased by 25%
                            const peerAnimSpeed = peer?.speedMultiplier ?? 1.0;
                            avatar.userData.mixer.update((deltaTime / 1000) * peerAnimSpeed * 1.25 * lodTimeMultiplier);
                        } else {
                            // Idle: play idle animation
                            if (avatar.userData.walkAction && avatar.userData.walkAction.isRunning()) {
                                avatar.userData.walkAction.stop();
                            }
                            if (avatar.userData.idleAction && !avatar.userData.idleAction.isRunning()) {
                                avatar.userData.idleAction.play();
                            }
                            avatar.userData.mixer.update((deltaTime / 1000) * 1 * lodTimeMultiplier);
                        }
                    }
                }
            }
        });
    }

    /**
     * Update death animations for all avatars
     * @param {number} deltaTime
     * @param {function} updateDeathAnimationCallback - Callback to update death animation
     */
    updateAvatarDeathAnimations(deltaTime, updateDeathAnimationCallback) {
        this.networkManager.avatars.forEach((avatar, peerId) => {
            if (avatar.userData.isDead) {
                // Validate deathStartTime - set to now if invalid (prevents NaN in animation)
                let deathStartTime = avatar.userData.deathStartTime;
                if (!deathStartTime || isNaN(deathStartTime)) {
                    console.warn(`[AvatarManager] Invalid deathStartTime for peer ${peerId}, setting to now`);
                    deathStartTime = Date.now();
                    avatar.userData.deathStartTime = deathStartTime;
                }

                updateDeathAnimationCallback(
                    avatar,
                    deathStartTime,
                    deltaTime,
                    avatar.userData.fallDirection || 1,
                    false
                );
            }
        });
    }

    /**
     * Remove avatar for disconnected peer
     * @param {string} peerId
     */
    removeAvatar(peerId) {
        const avatar = this.networkManager.avatars.get(peerId);
        if (!avatar) return false;

        // Clean up combat stance cache
        this.combatStanceCache.delete(peerId);

        // 1. Stop and clean up animation mixer
        if (avatar.userData.mixer) {
            avatar.userData.mixer.stopAllAction();
            avatar.userData.mixer = null;
        }

        // 2. Clear action references
        avatar.userData.walkAction = null;
        avatar.userData.idleAction = null;
        avatar.userData.combatAction = null;
        avatar.userData.choppingAction = null;
        avatar.userData.shootAction = null;

        // 3. Dispose muzzle flash
        if (avatar.userData.muzzleFlash) {
            avatar.userData.muzzleFlash.dispose();
            avatar.userData.muzzleFlash = null;
        }

        // 4. Dispose rifle mesh and its materials
        if (avatar.userData.rifle) {
            avatar.userData.rifle.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            });
            avatar.userData.rifle = null;
        }

        // 5. Remove physics character controller
        const game = this.networkManager.game;
        if (game?.physicsManager) {
            game.physicsManager.removeCharacterController(`peer_${peerId}`);
        }

        // 6. Remove from scene and dispose all avatar meshes/materials
        this.scene.remove(avatar);
        avatar.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });

        this.networkManager.avatars.delete(peerId);
        return true;
    }

    /**
     * Get all avatars
     * @returns {Map}
     */
    getAvatars() {
        return this.networkManager.avatars;
    }

    /**
     * Get avatar by peer ID
     * @param {string} peerId
     * @returns {THREE.Object3D|null}
     */
    getAvatar(peerId) {
        return this.networkManager.avatars.get(peerId);
    }

    /**
     * Check if avatar is alive
     * @param {string} peerId
     * @returns {boolean}
     */
    isAvatarAlive(peerId) {
        const avatar = this.networkManager.avatars.get(peerId);
        return avatar && !avatar.userData.isDead;
    }

    /**
     * Play shoot animation and muzzle flash for a peer avatar
     * @param {string} peerId
     */
    playShootAnimation(peerId) {
        const avatar = this.networkManager.avatars.get(peerId);
        if (!avatar || avatar.userData.isDead) return;

        // Only show rifle and shooting effects if peer actually has one (synced via player_tick)
        const peer = this.networkManager.peerGameData.get(peerId);
        const peerHasRifle = peer?.hasRifle || false;

        if (!peerHasRifle) {
            return; // Can't shoot without a rifle
        }

        if (avatar.userData.rifle) {
            avatar.userData.rifle.visible = true;
        }

        // Trigger muzzle flash and gunsmoke
        if (avatar.userData.muzzleFlash) {
            avatar.userData.muzzleFlash.flash();
            // Spawn gunsmoke at barrel position
            if (this.effectManager) {
                const barrelPos = new THREE.Vector3();
                avatar.userData.muzzleFlash.sprite.getWorldPosition(barrelPos);
                this.effectManager.spawnGunSmoke(barrelPos);
            }
        }

        // Play shoot animation if available
        if (avatar.userData.shootAction) {
            avatar.userData.shootAction.reset();
            avatar.userData.shootAction.play();
        }
    }

    /**
     * Lerp between two angles (handles wraparound)
     * @param {number} a - Start angle in radians
     * @param {number} b - End angle in radians
     * @param {number} t - Interpolation factor (0-1)
     * @returns {number} - Interpolated angle
     */
    lerpAngle(a, b, t) {
        let diff = b - a;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return a + diff * t;
    }

    /**
     * Set avatar shirt color based on faction
     * @param {string} peerId - Peer client ID
     * @param {number} factionId - 1 (Southguard), 3 (Northmen), or null (neutral)
     */
    setAvatarFaction(peerId, factionId) {
        const avatar = this.networkManager.avatars.get(peerId);
        if (!avatar || !avatar.userData.shirtMesh) return;
        // Don't update dead bodies - their appearance should be frozen
        if (avatar.userData.isDead) return;

        const factionColors = CONFIG.FACTION_COLORS[factionId] || CONFIG.FACTION_COLORS.default;
        avatar.userData.shirtMesh.material.color.setHex(factionColors.shirt);
        avatar.userData.shirtMesh.material.needsUpdate = true;
        avatar.userData.factionId = factionId;
    }

    /**
     * Update horse animation for peer based on movement
     * @param {object} peerData - Peer data object
     * @param {number} deltaTime - Time delta in ms
     */
    updatePeerHorseAnimation(peerData, deltaTime) {
        const mobileEntity = peerData.mobileEntity;
        if (!mobileEntity?.mixer) return;

        // Update mixer
        mobileEntity.mixer.update(deltaTime / 1000);

        const walkAction = mobileEntity.walkAction;
        if (!walkAction) return;

        if (mobileEntity.isMoving) {
            // Estimate velocity from position delta
            const distMoved = mobileEntity.targetPosition.distanceTo(mobileEntity.lastPosition);
            const estimatedVelocity = distMoved / 0.5;  // position updates ~500ms

            const game = this.networkManager.game;
            const config = game?.mobileEntitySystem?.getConfig('horse') || {
                maxSpeed: 0.0015,
                baseAnimationSpeed: 2.0,
                minAnimationSpeed: 0.6
            };
            const maxSpeedPerSec = config.maxSpeed * 1000;
            const speedRatio = Math.min(estimatedVelocity / maxSpeedPerSec, 1.0);
            const animSpeed = config.minAnimationSpeed + speedRatio * (config.baseAnimationSpeed - config.minAnimationSpeed);

            walkAction.setEffectiveTimeScale(animSpeed);
            if (!walkAction.isRunning()) walkAction.play();
        } else {
            if (walkAction.isRunning()) walkAction.stop();
        }
    }
}
