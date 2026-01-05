import * as THREE from 'three';
import { modelManager } from '../objects.js';
import { MuzzleFlash } from '../effects/MuzzleFlash.js';

/**
 * PlayerModelSetup
 * Handles loading and configuring the player model, animations, and attached items.
 */
export class PlayerModelSetup {
    constructor(game) {
        this.game = game;
    }

    setup() {
        const manGLTF = modelManager.getGLTF('man');

        if (!manGLTF) {
            console.error('Man model not loaded');
            return;
        }

        // CRITICAL FIX: Use original scene directly - cloning breaks skeleton binding for SkinnedMesh
        const playerMesh = manGLTF.scene;
        playerMesh.scale.set(this.game.playerScale, this.game.playerScale, this.game.playerScale);

        // Setup materials and proper lighting
        playerMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = false;
                child.renderOrder = 1;

                if (child.material) {
                    child.material.depthWrite = true;
                    child.material.depthTest = true;

                    if (child.material.type === 'MeshStandardMaterial') {
                        child.material.needsUpdate = true;
                    }
                }
            }
        });

        // Add to player object
        this.game.playerObject.add(playerMesh);

        // Calculate bounding box to find model's dimensions
        const box = new THREE.Box3().setFromObject(playerMesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = new THREE.Vector3();
        box.getSize(size);

        // Store the Z offset needed to align feet with click position
        this.game.playerModelOffset = center.z;

        // Store actual model height for terrain following
        this.game.playerModelHeight = size.y;

        // Setup animations
        this.setupAnimations(manGLTF, playerMesh);

        // Attach rifle to player
        this.attachRifle(playerMesh);

        // Set player object reference in NetworkManager for P2P state sync
        this.game.networkManager.setPlayerObject(this.game.playerObject);
    }

    setupAnimations(manGLTF, playerMesh) {
        if (!manGLTF.animations || manGLTF.animations.length === 0) {
            return;
        }

        this.game.animationMixer = new THREE.AnimationMixer(playerMesh);

        // Update PlayerActions with the animation mixer
        if (this.game.playerActions) {
            this.game.playerActions.setAnimationMixer(this.game.animationMixer);
        }

        // Search for walk animation by name
        const walkAnimation = manGLTF.animations.find(anim =>
            anim.name.toLowerCase().includes('walk')
        );

        if (walkAnimation) {
            this.game.animationAction = this.game.animationMixer.clipAction(walkAnimation);
            this.game.animationAction.play();
        }

        // Search for pickaxe animation
        let choppingAnimation = manGLTF.animations.find(anim => {
            const name = anim.name.toLowerCase();
            if (name === 'pickaxe' || name === 'pickaxe.001' || name === 'armature|pickaxe') {
                return true;
            }
            return name.includes('pickaxe') || name.includes('pick') ||
                   name.includes('axe') || name.includes('action');
        });

        if (choppingAnimation) {
            this.game.choppingAction = this.game.animationMixer.clipAction(choppingAnimation);
            this.game.choppingAction.loop = THREE.LoopRepeat;
        } else if (walkAnimation) {
            this.game.choppingAction = this.game.animationMixer.clipAction(walkAnimation);
            this.game.choppingAction.loop = THREE.LoopRepeat;
        }

        // Search for idle animation
        const idleAnimation = manGLTF.animations.find(anim =>
            anim.name.toLowerCase().includes('idle')
        );

        if (idleAnimation) {
            this.game.idleAction = this.game.animationMixer.clipAction(idleAnimation);
            this.game.idleAction.loop = THREE.LoopRepeat;
        }

        // Update PlayerActions with chopping animation
        if (this.game.playerActions && this.game.choppingAction) {
            this.game.playerActions.setChoppingAnimation(this.game.choppingAction);
        }

        // Update CraftingSystem with animation references
        if (this.game.craftingSystem) {
            this.game.craftingSystem.setAnimationReferences(this.game.animationMixer, this.game.choppingAction);
            this.game.craftingSystem.setInventoryToggleCallback(this.game.toggleInventory.bind(this.game));
        }

        // Update ResourceManager with animation references
        if (this.game.resourceManager) {
            this.game.resourceManager.setAnimationReferences(this.game.animationMixer, this.game.choppingAction);
        }

        // Update BuildingSystem with animation references
        if (this.game.buildingSystem) {
            this.game.buildingSystem.setAnimationReferences(this.game.animationMixer, this.game.choppingAction);
        }

        // Search for shooting animation
        const shootAnimation = manGLTF.animations.find(anim => {
            const name = anim.name.toLowerCase();
            return name.includes('shoot') || name.includes('fire') ||
                   name.includes('rifle') || name.includes('gun') ||
                   name.includes('aim');
        });

        if (shootAnimation) {
            this.game.shootAction = this.game.animationMixer.clipAction(shootAnimation);
            this.game.shootAction.loop = THREE.LoopOnce;
            this.game.shootAction.clampWhenFinished = true;

            if (this.game.playerCombat) {
                this.game.playerCombat.setShootAnimation(this.game.shootAction);
            }
        }

        // Search for combat animation
        const combatAnimation = manGLTF.animations.find(anim =>
            anim.name.toLowerCase().includes('combat')
        );

        if (combatAnimation) {
            this.game.combatAction = this.game.animationMixer.clipAction(combatAnimation);
            this.game.combatAction.loop = THREE.LoopRepeat;
        }
    }

    attachRifle(playerMesh) {
        const rifleModel = modelManager.getModel('rifle');
        if (!rifleModel) {
            return;
        }

        const rifleMesh = rifleModel.clone();

        // Find Bone014 (hand bone) in the player skeleton
        let handBone = null;
        playerMesh.traverse((child) => {
            if (child.isBone && child.name === 'Bone014') {
                handBone = child;
            }
        });

        if (!handBone) {
            console.warn('[PLAYER] Could not find Bone014 for rifle attachment');
            return;
        }

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
            }
        });

        // Attach rifle to hand bone
        handBone.add(rifleMesh);

        // Store reference for later use
        this.game.playerRifle = rifleMesh;

        // Create muzzle flash effect
        this.game.playerMuzzleFlash = new MuzzleFlash();
        this.game.playerMuzzleFlash.attachTo(rifleMesh);

        // Connect muzzle flash to combat system
        if (this.game.playerCombat) {
            this.game.playerCombat.setMuzzleFlash(this.game.playerMuzzleFlash);
        }
    }
}
