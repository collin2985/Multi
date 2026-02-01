import GUI from 'lil-gui';
import { TERRAIN_CONFIG } from './terrainsystem.js';

/**
 * TreeGUI - Debug controls for tree billboard and model parameters
 */
export class TreeGUI {
    constructor(billboardSystem, deerManager, waterSystem, sceneObjectFactory, rockModelSystem, structureModelSystem) {
        this.billboardSystem = billboardSystem;
        this.deerManager = deerManager;
        this.waterSystem = waterSystem;
        this.sceneObjectFactory = sceneObjectFactory;
        this.rockModelSystem = rockModelSystem;
        this.structureModelSystem = structureModelSystem;
        this.gui = null;

        // Store planted tree config for GUI control (shared with SceneObjectFactory/MessageRouter)
        this.plantedTreeConfig = {
            pine: { yOffset: -0.1 },
            apple: { yOffset: -0.1 },
            vegetables: { yOffset: -0.1 },
            hemp: { yOffset: -0.1 }
        };

        this.setupGUI();
    }

    setupGUI() {
        // GUI enabled for structure billboard adjustments
        try {
            this.gui = new GUI({ title: 'Debug Controls' });
            this.gui.domElement.style.position = 'absolute';
            this.gui.domElement.style.top = '10px';
            this.gui.domElement.style.left = '10px';
            this.gui.domElement.style.zIndex = '9999';
        } catch (e) {
            console.error('[TreeGUI] Failed to create GUI:', e);
            return;
        }

        // Structure billboard controls
        this.setupStructureBillboardControls();

        // Close main GUI by default
        this.gui.close();
    }

    setupPlantedTreeControls() {
        // GUI controls commented out - using fixed defaults
        // const plantedFolder = this.gui.addFolder('Planted Trees (Growing)');

        // // Pine planted yOffset
        // this.plantedTreeParams = {
        //     pineYOffset: this.plantedTreeConfig.pine.yOffset,
        //     appleYOffset: this.plantedTreeConfig.apple.yOffset,
        //     vegetablesYOffset: this.plantedTreeConfig.vegetables.yOffset
        // };

        // plantedFolder.add(this.plantedTreeParams, 'pineYOffset', -5, 2, 0.1)
        //     .name('Pine Y Offset')
        //     .onChange((value) => {
        //         this.plantedTreeConfig.pine.yOffset = value;
        //         this.updatePlantedTreesInScene('pine', value);
        //     });

        // plantedFolder.add(this.plantedTreeParams, 'appleYOffset', -5, 2, 0.1)
        //     .name('Apple Y Offset')
        //     .onChange((value) => {
        //         this.plantedTreeConfig.apple.yOffset = value;
        //         this.updatePlantedTreesInScene('apple', value);
        //     });

        // plantedFolder.add(this.plantedTreeParams, 'vegetablesYOffset', -2, 2, 0.05)
        //     .name('Vegetables Y Offset')
        //     .onChange((value) => {
        //         this.plantedTreeConfig.vegetables.yOffset = value;
        //         this.updatePlantedTreesInScene('vegetables', value);
        //     });
    }

    updatePlantedTreesInScene(treeType, yOffset) {
        // Find all planted trees of this type in the scene and update their Y position
        if (!this.sceneObjectFactory?.game?.scene) return;

        this.sceneObjectFactory.game.scene.traverse((object) => {
            if (object.userData?.isGrowing) {
                const modelType = object.userData.modelType || '';
                const visualType = modelType.startsWith('planted_') ? modelType.replace('planted_', '') : modelType;

                if (visualType === treeType) {
                    // Store original base Y and original yOffset if not already stored
                    if (object.userData._originalY === undefined) {
                        object.userData._originalY = object.position.y;
                        object.userData._originalYOffset = object.userData.yOffset || 0;
                    }
                    // Calculate position adjustment based on difference from original offset
                    const offsetDelta = yOffset - object.userData._originalYOffset;
                    object.position.y = object.userData._originalY + offsetDelta;
                }
            }
        });
    }

    setupPineBillboardControls() {
        if (!this.billboardSystem) return;

        const pineBillboardFolder = this.gui.addFolder('Pine Billboard');

        // Get current pine config
        const pineConfig = this.billboardSystem.billboardConfig.pine;

        // Create params object for GUI binding
        this.pineBillboardParams = {
            width: pineConfig.width,
            height: pineConfig.height,
            yOffset: pineConfig.yOffset,
            brightness: pineConfig.brightness
        };

        pineBillboardFolder.add(this.pineBillboardParams, 'width', 0.5, 20, 0.5)
            .name('Width')
            .onChange((value) => {
                this.billboardSystem.updateBillboardParameters('pine', 'width', value);
            });

        pineBillboardFolder.add(this.pineBillboardParams, 'height', 0.5, 20, 0.5)
            .name('Height')
            .onChange((value) => {
                this.billboardSystem.updateBillboardParameters('pine', 'height', value);
            });

        pineBillboardFolder.add(this.pineBillboardParams, 'yOffset', -5, 5, 0.1)
            .name('Y Offset')
            .onChange((value) => {
                this.billboardSystem.updateBillboardParameters('pine', 'yOffset', value);
            });

        pineBillboardFolder.add(this.pineBillboardParams, 'brightness', 0.1, 2, 0.05)
            .name('Brightness')
            .onChange((value) => {
                this.billboardSystem.updateBillboardParameters('pine', 'brightness', value);
            });
    }

    setupAppleBillboardControls() {
        if (!this.billboardSystem) return;

        const appleBillboardFolder = this.gui.addFolder('Apple Billboard');

        // Get current apple config
        const appleConfig = this.billboardSystem.billboardConfig.apple;

        // Create params object for GUI binding
        this.appleBillboardParams = {
            width: appleConfig.width,
            height: appleConfig.height,
            yOffset: appleConfig.yOffset,
            brightness: appleConfig.brightness
        };

        appleBillboardFolder.add(this.appleBillboardParams, 'width', 0.5, 20, 0.5)
            .name('Width')
            .onChange((value) => {
                this.billboardSystem.updateBillboardParameters('apple', 'width', value);
            });

        appleBillboardFolder.add(this.appleBillboardParams, 'height', 0.5, 20, 0.5)
            .name('Height')
            .onChange((value) => {
                this.billboardSystem.updateBillboardParameters('apple', 'height', value);
            });

        appleBillboardFolder.add(this.appleBillboardParams, 'yOffset', -5, 5, 0.1)
            .name('Y Offset')
            .onChange((value) => {
                this.billboardSystem.updateBillboardParameters('apple', 'yOffset', value);
            });

        appleBillboardFolder.add(this.appleBillboardParams, 'brightness', 0.1, 2, 0.05)
            .name('Brightness')
            .onChange((value) => {
                this.billboardSystem.updateBillboardParameters('apple', 'brightness', value);
            });
    }

    setupRockBillboardControls() {
        if (!this.billboardSystem) return;

        const rockTypes = ['limestone', 'sandstone', 'clay', 'iron'];
        this.rockBillboardParams = {};

        const rocksFolder = this.gui.addFolder('Rock Billboards');

        for (const rockType of rockTypes) {
            const config = this.billboardSystem.billboardConfig[rockType];
            if (!config) continue;

            const folder = rocksFolder.addFolder(rockType.charAt(0).toUpperCase() + rockType.slice(1));

            this.rockBillboardParams[rockType] = {
                width: config.width,
                height: config.height,
                yOffset: config.yOffset,
                brightness: config.brightness,
                colorR: config.colorR,
                colorG: config.colorG,
                colorB: config.colorB
            };

            folder.add(this.rockBillboardParams[rockType], 'width', 0.5, 10, 0.1)
                .name('Width')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(rockType, 'width', value);
                });

            folder.add(this.rockBillboardParams[rockType], 'height', 0.5, 10, 0.1)
                .name('Height')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(rockType, 'height', value);
                });

            folder.add(this.rockBillboardParams[rockType], 'yOffset', -3, 3, 0.1)
                .name('Y Offset')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(rockType, 'yOffset', value);
                });

            folder.add(this.rockBillboardParams[rockType], 'brightness', 0.1, 2, 0.05)
                .name('Brightness')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(rockType, 'brightness', value);
                });

            folder.add(this.rockBillboardParams[rockType], 'colorR', 0, 2, 0.05)
                .name('Color R')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(rockType, 'colorR', value);
                });

            folder.add(this.rockBillboardParams[rockType], 'colorG', 0, 2, 0.05)
                .name('Color G')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(rockType, 'colorG', value);
                });

            folder.add(this.rockBillboardParams[rockType], 'colorB', 0, 2, 0.05)
                .name('Color B')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(rockType, 'colorB', value);
                });
        }

        // Debug folder with Show All LODs toggle
        const debugFolder = rocksFolder.addFolder('Debug');
        this.rockDebugParams = { showAllLODs: false };
        debugFolder.add(this.rockDebugParams, 'showAllLODs')
            .name('Show All LODs')
            .onChange((enabled) => {
                this.billboardSystem.debugMode = enabled;
                if (this.rockModelSystem) {
                    this.rockModelSystem.setDebugShowAll(enabled);
                }
            });

        rocksFolder.open();
    }

    /**
     * Enable rock billboard GUI on demand
     * Call from console: game.treeGUI.enableRockGUI()
     */
    enableRockGUI() {
        if (this.gui) {
            return;
        }

        try {
            this.gui = new GUI({ title: 'Rock Billboard Controls' });
            this.gui.domElement.style.position = 'absolute';
            this.gui.domElement.style.top = '10px';
            this.gui.domElement.style.left = '10px';
            this.gui.domElement.style.zIndex = '9999';
        } catch (e) {
            console.error('[TreeGUI] Failed to create GUI:', e);
            return;
        }

        this.setupRockBillboardControls();
    }

    /**
     * Enable structure billboard GUI on demand
     * Call from console: game.treeGUI.enableStructureGUI()
     */
    enableStructureGUI() {
        if (this.gui) {
            // GUI already active - adding structure controls
        } else {
            try {
                this.gui = new GUI({ title: 'Structure Billboard Controls' });
                this.gui.domElement.style.position = 'absolute';
                this.gui.domElement.style.top = '10px';
                this.gui.domElement.style.left = '10px';
                this.gui.domElement.style.zIndex = '9999';
            } catch (e) {
                console.error('[TreeGUI] Failed to create GUI:', e);
                return;
            }
        }

        this.setupStructureBillboardControls();
    }

    setupStructureBillboardControls() {
        if (!this.billboardSystem) return;

        // dock and market excluded - rectangular shapes don't billboard well
        const structureTypes = [
            'tent', 'outpost', 'campfire', 'horse',
            'house', 'bakery', 'gardener', 'miner', 'woodcutter',
            'stonemason', 'wall', 'tileworks', 'blacksmith', 'ironworks', 'fisherman',
            'boat', 'sailboat', 'ship2', 'bearden', 'crate', 'construction', '2x2construction',
            '2x8construction', '3x3construction', '10x4construction'
        ];
        this.structureBillboardParams = {};

        const structuresFolder = this.gui.addFolder('Structure Billboards');

        // Debug folder FIRST with Show All LODs toggle
        const debugFolder = structuresFolder.addFolder('== DEBUG ==');
        this.structureDebugParams = { showAllLODs: false };
        debugFolder.add(this.structureDebugParams, 'showAllLODs')
            .name('Show Billboards Close')
            .onChange((enabled) => {
                // Enable billboard debug mode (shows billboards at all distances)
                this.billboardSystem.debugMode = enabled;
                // Enable structure model debug mode (shows 3D models at all distances)
                if (this.structureModelSystem) {
                    this.structureModelSystem.setDebugShowAll(enabled);
                }
            });
        debugFolder.open();

        for (const structType of structureTypes) {
            const config = this.billboardSystem.billboardConfig[structType];
            if (!config) continue;

            // Format name nicely
            const displayName = structType.charAt(0).toUpperCase() + structType.slice(1);
            const folder = structuresFolder.addFolder(displayName);

            this.structureBillboardParams[structType] = {
                width: config.width,
                height: config.height,
                yOffset: config.yOffset,
                brightness: config.brightness
            };

            folder.add(this.structureBillboardParams[structType], 'width', 0.5, 15, 0.1)
                .name('Width')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(structType, 'width', value);
                });

            folder.add(this.structureBillboardParams[structType], 'height', 0.5, 15, 0.1)
                .name('Height')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(structType, 'height', value);
                });

            folder.add(this.structureBillboardParams[structType], 'yOffset', -5, 5, 0.1)
                .name('Y Offset')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(structType, 'yOffset', value);
                });

            folder.add(this.structureBillboardParams[structType], 'brightness', 0.1, 2, 0.05)
                .name('Brightness')
                .onChange((value) => {
                    this.billboardSystem.updateBillboardParameters(structType, 'brightness', value);
                });

            // Start each structure folder CLOSED to save space
            folder.close();
        }

        structuresFolder.open();
    }

    setupDeerControls() {
        if (!this.deerManager) return;

        const deerFolder = this.gui.addFolder('Deer');

        // Create params object for GUI binding
        this.deerParams = {
            scale: 50,
            yOffset: 0,
            brightness: 1.0
        };

        deerFolder.add(this.deerParams, 'scale', 0.5, 100, 0.5)
            .name('Scale')
            .onChange((value) => {
                this.deerManager.deerMeshes.forEach(v => {
                    v.mesh.scale.set(value, value, value);
                });
            });

        deerFolder.add(this.deerParams, 'yOffset', -10, 10, 0.1)
            .name('Y Offset')
            .onChange((value) => {
                this.deerManager.deerMeshes.forEach(v => {
                    const entity = this.deerManager.controller?.entities.get(
                        Array.from(this.deerManager.deerMeshes.entries())
                            .find(([k, val]) => val === v)?.[0]
                    );
                    if (entity) {
                        v.mesh.position.y = entity.position.y + value;
                    }
                });
                // Store for new deer
                this.deerManager.yOffset = value;
            });

        deerFolder.add(this.deerParams, 'brightness', 0.1, 5, 0.1)
            .name('Brightness')
            .onChange((value) => {
                this.deerManager.deerMeshes.forEach(v => {
                    v.mesh.traverse(child => {
                        if (child.isMesh && child.material) {
                            if (!child.material._originalColor) {
                                child.material._originalColor = child.material.color.clone();
                            }
                            child.material.color.copy(child.material._originalColor).multiplyScalar(value);
                        }
                    });
                });
            });
    }

    setupWaterControls() {
        if (!this.waterSystem) return;

        const waterFolder = this.gui.addFolder('Water');

        // === Wave Crest Glow ===
        const sssFolder = waterFolder.addFolder('Wave Crest Glow');
        this.sssParams = {
            enabled: true,
            strength: 0.1,
            colorR: 0.1,
            colorG: 0.4,
            colorB: 0.35
        };
        sssFolder.add(this.sssParams, 'enabled').name('Enable')
            .onChange((v) => this.waterSystem.setUniform('enableSSS', v ? 1.0 : 0.0));
        sssFolder.add(this.sssParams, 'strength', 0, 1, 0.05).name('Strength')
            .onChange((v) => this.waterSystem.setUniform('sssStrength', v));
        sssFolder.add(this.sssParams, 'colorR', 0, 1, 0.05).name('Color R')
            .onChange(() => this._updateSSSColor());
        sssFolder.add(this.sssParams, 'colorG', 0, 1, 0.05).name('Color G')
            .onChange(() => this._updateSSSColor());
        sssFolder.add(this.sssParams, 'colorB', 0, 1, 0.05).name('Color B')
            .onChange(() => this._updateSSSColor());

        // === Detail Normals ===
        const detailFolder = waterFolder.addFolder('Detail Normals');
        this.detailParams = {
            enabled: true,
            strength: 1.0,
            scale1: 0.01,
            scale2: 0.02,
            fadeStart: 10.0,
            fadeEnd: 400.0
        };
        detailFolder.add(this.detailParams, 'enabled').name('Enable')
            .onChange((v) => this.waterSystem.setUniform('enableDetailNormals', v ? 1.0 : 0.0));
        detailFolder.add(this.detailParams, 'strength', 0, 1, 0.05).name('Strength')
            .onChange((v) => this.waterSystem.setUniform('detailNormalStrength', v));
        detailFolder.add(this.detailParams, 'scale1', 0.01, 0.2, 0.005).name('Scale 1')
            .onChange((v) => this.waterSystem.setUniform('detailNormalScale1', v));
        detailFolder.add(this.detailParams, 'scale2', 0.01, 0.3, 0.01).name('Scale 2')
            .onChange((v) => this.waterSystem.setUniform('detailNormalScale2', v));
        detailFolder.add(this.detailParams, 'fadeStart', 10, 150, 5).name('Fade Start')
            .onChange((v) => this.waterSystem.setUniform('detailNormalFadeStart', v));
        detailFolder.add(this.detailParams, 'fadeEnd', 50, 400, 10).name('Fade End')
            .onChange((v) => this.waterSystem.setUniform('detailNormalFadeEnd', v));

        // === Crest Color ===
        const crestFolder = waterFolder.addFolder('Crest Color');
        this.crestParams = {
            enabled: true,
            strength: 0.25,
            colorR: 0.2,
            colorG: 0.55,
            colorB: 0.5
        };
        crestFolder.add(this.crestParams, 'enabled').name('Enable')
            .onChange((v) => this.waterSystem.setUniform('enableCrestColor', v ? 1.0 : 0.0));
        crestFolder.add(this.crestParams, 'strength', 0, 1, 0.05).name('Strength')
            .onChange((v) => this.waterSystem.setUniform('crestColorStrength', v));
        crestFolder.add(this.crestParams, 'colorR', 0, 1, 0.05).name('Color R')
            .onChange(() => this._updateCrestColor());
        crestFolder.add(this.crestParams, 'colorG', 0, 1, 0.05).name('Color G')
            .onChange(() => this._updateCrestColor());
        crestFolder.add(this.crestParams, 'colorB', 0, 1, 0.05).name('Color B')
            .onChange(() => this._updateCrestColor());

        // === Shimmer (Sparkles) ===
        const shimmerFolder = waterFolder.addFolder('Shimmer');
        this.shimmerParams = {
            enabled: true,
            strength: 1.25,
            scale: 0.05,
            speed: 0.01
        };
        shimmerFolder.add(this.shimmerParams, 'enabled').name('Enable')
            .onChange((v) => this.waterSystem.setUniform('enableGlitter', v ? 1.0 : 0.0));
        shimmerFolder.add(this.shimmerParams, 'strength', 0, 10, 0.25).name('Strength')
            .onChange((v) => this.waterSystem.setUniform('shimmerStrength', v));
        shimmerFolder.add(this.shimmerParams, 'scale', 0.05, 1.0, 0.05).name('Scale')
            .onChange((v) => this.waterSystem.setUniform('shimmerScale', v));
        shimmerFolder.add(this.shimmerParams, 'speed', 0.01, 0.2, 0.01).name('Speed')
            .onChange((v) => this.waterSystem.setUniform('shimmerSpeed', v));

        // === Deep Water Color ===
        const deepFolder = waterFolder.addFolder('Deep Water Color');
        this.deepParams = {
            enabled: true,
            depth: 12.0,
            shallowR: 0.18,
            shallowG: 0.52,
            shallowB: 0.46,
            deepR: 0.02,
            deepG: 0.12,
            deepB: 0.22
        };
        deepFolder.add(this.deepParams, 'enabled').name('Enable')
            .onChange((v) => this.waterSystem.setUniform('enableDeepColor', v ? 1.0 : 0.0));
        deepFolder.add(this.deepParams, 'depth', 1, 30, 1).name('Depth Factor')
            .onChange((v) => this.waterSystem.setUniform('deepColorDepth', v));

        const shallowSubfolder = deepFolder.addFolder('Shallow Color');
        shallowSubfolder.add(this.deepParams, 'shallowR', 0, 1, 0.02).name('R')
            .onChange(() => this._updateWaterColor());
        shallowSubfolder.add(this.deepParams, 'shallowG', 0, 1, 0.02).name('G')
            .onChange(() => this._updateWaterColor());
        shallowSubfolder.add(this.deepParams, 'shallowB', 0, 1, 0.02).name('B')
            .onChange(() => this._updateWaterColor());

        const deepSubfolder = deepFolder.addFolder('Deep Color');
        deepSubfolder.add(this.deepParams, 'deepR', 0, 1, 0.02).name('R')
            .onChange(() => this._updateDeepWaterColor());
        deepSubfolder.add(this.deepParams, 'deepG', 0, 1, 0.02).name('G')
            .onChange(() => this._updateDeepWaterColor());
        deepSubfolder.add(this.deepParams, 'deepB', 0, 1, 0.02).name('B')
            .onChange(() => this._updateDeepWaterColor());

        // === Foam Controls (existing) ===
        const foamFolder = waterFolder.addFolder('Foam');
        this.foamParams = {
            foamWaveInfluence: TERRAIN_CONFIG.FOAM_WAVE_INFLUENCE,
            whitecapThreshold: 0.1,
            foamMaxDepth: TERRAIN_CONFIG.FOAM_MAX_DEPTH,
            foamTextureScale: TERRAIN_CONFIG.FOAM_TEXTURE_SCALE,
            foamTextureSpeed: TERRAIN_CONFIG.FOAM_TEXTURE_SPEED,
            foamTextureIntensity: TERRAIN_CONFIG.FOAM_TEXTURE_INTENSITY,
            foamTextureDepthLimit: TERRAIN_CONFIG.FOAM_TEXTURE_DEPTH_LIMIT,
            waveDampingMinDepth: TERRAIN_CONFIG.WAVE_DAMPING_MIN_DEPTH,
            waveDampingMaxDepth: TERRAIN_CONFIG.WAVE_DAMPING_MAX_DEPTH
        };

        foamFolder.add(this.foamParams, 'foamWaveInfluence', 0, 1, 0.05)
            .name('Whitecap Strength')
            .onChange((v) => this.waterSystem.setUniform('foamWaveInfluence', v));
        foamFolder.add(this.foamParams, 'whitecapThreshold', 0.02, 0.15, 0.005)
            .name('Whitecap Threshold')
            .onChange((v) => this.waterSystem.setUniform('whitecapThreshold', v));
        foamFolder.add(this.foamParams, 'foamMaxDepth', 1, 20, 0.5)
            .name('Foam Max Depth')
            .onChange((v) => this.waterSystem.setUniform('foamMaxDepth', v));
        foamFolder.add(this.foamParams, 'foamTextureScale', 0.01, 0.5, 0.01)
            .name('Foam Texture Scale')
            .onChange((v) => this.waterSystem.setUniform('foamTextureScale', v));
        foamFolder.add(this.foamParams, 'foamTextureSpeed', 0.1, 3, 0.1)
            .name('Foam Texture Speed')
            .onChange((v) => this.waterSystem.setUniform('foamTextureSpeed', v));
        foamFolder.add(this.foamParams, 'foamTextureIntensity', 0.5, 3, 0.1)
            .name('Foam Intensity')
            .onChange((v) => this.waterSystem.setUniform('foamTextureIntensity', v));
        foamFolder.add(this.foamParams, 'foamTextureDepthLimit', 1, 15, 0.5)
            .name('Foam Depth Limit')
            .onChange((v) => this.waterSystem.setUniform('foamTextureDepthLimit', v));
        foamFolder.add(this.foamParams, 'waveDampingMinDepth', 0, 5, 0.5)
            .name('Wave Dead Zone')
            .onChange((v) => this.waterSystem.setUniform('waveDampingMinDepth', v));
        foamFolder.add(this.foamParams, 'waveDampingMaxDepth', 1, 20, 0.5)
            .name('Wave Full Depth')
            .onChange((v) => this.waterSystem.setUniform('waveDampingMaxDepth', v));

        // Open water folder by default
        waterFolder.open();
    }

    _updateSSSColor() {
        const color = { x: this.sssParams.colorR, y: this.sssParams.colorG, z: this.sssParams.colorB };
        this.waterSystem.setUniform('sssColor', color);
    }

    _updateCrestColor() {
        const color = { x: this.crestParams.colorR, y: this.crestParams.colorG, z: this.crestParams.colorB };
        this.waterSystem.setUniform('crestColor', color);
    }

    _updateWaterColor() {
        const color = { x: this.deepParams.shallowR, y: this.deepParams.shallowG, z: this.deepParams.shallowB };
        this.waterSystem.setUniform('waterColor', color);
    }

    _updateDeepWaterColor() {
        const color = { x: this.deepParams.deepR, y: this.deepParams.deepG, z: this.deepParams.deepB };
        this.waterSystem.setUniform('deepWaterColor', color);
    }

    destroy() {
        if (this.gui) {
            this.gui.destroy();
            this.gui = null;
        }
    }
}
