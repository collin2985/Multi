# Fishing Net Implementation Guide

## Current Understanding

### Item Structure
All items in inventory have these properties:
- `id`: unique identifier
- `type`: item name (e.g., 'axe', 'pickaxe', 'fishingnet')
- `x`, `y`: position in inventory grid
- `width`, `height`: size in grid slots
- `rotation`: 0 or 90 degrees
- `quality`: 0-100 value (affects tool performance)
- `durability`: current durability (max is 100 for all tools)

### Tool Durability System
Looking at other tools in `ResourceManager.js:239-243`:
- Durability loss = `Math.ceil(100 / materialQuality)`
- Quality 100 material = 1 durability loss
- Quality 50 material = 2 durability loss
- Quality 10 material = 10 durability loss

However, tools also have flat durability loss from CONFIG.TOOLS:
- Axe: 10 durability per tree
- Saw: 10 durability per plank batch
- Pickaxe: 10 durability per stone harvest
- Hammer: 5 durability per build
- Chisel: Dynamic based on stone quality `Math.ceil(100 / stoneQuality)`

## Fishing Net Requirements

### Net Item Properties
- Type: `fishingnet`
- Size: **2x2** in inventory
- Quality: Random value (like other tools when purchased from market)
- Max Durability: 100 (standard for all tools)
- Durability Loss: **Uses Universal Tool Durability System**
  - Formula: `Math.ceil((10 * fishQuality) / netQuality)`
  - Better nets last longer
  - Higher quality fish wear nets more
  - Example: Q100 net + Q100 fish = 10 loss
  - Example: Q100 net + Q50 fish = 5 loss
  - Example: Q50 net + Q100 fish = 20 loss

### Fish Item Properties
- Type: `fish`
- Size: **1x1** in inventory
- Quality: **Affected by net quality as a multiplier**
  - Formula: `baseFishQuality * (netQuality / 100)`
  - Base fish quality is random (e.g., 10-100)
  - Net quality acts as a percentage multiplier
  - Example: Base 100 fish * 50% net quality = 50 quality fish
  - Example: Base 80 fish * 100% net quality = 80 quality fish
  - Example: Base 60 fish * 25% net quality = 15 quality fish
- Base Durability: **30**
- Final Durability: `Math.floor(30 * (fishQuality / 100))`
  - Example: 50 quality fish = Math.floor(30 * 0.50) = 15 durability
  - Example: 100 quality fish = Math.floor(30 * 1.0) = 30 durability
  - Example: 10 quality fish = Math.floor(30 * 0.10) = 3 durability

### Fishing Mechanics
- **Trigger**: Player on shore (NOT in water, but water nearby within 0.75 units)
  - Player position height >= 1.02 (on land)
  - Check points around player for water (height < 1.02)
  - Similar to other proximity checks (0.75 unit radius)
- **Action**: Shows "Fishing" button in UI (similar to chop/harvest buttons)
- **Required Tool**: Fishing net with durability > 0
- **Animation**: Use existing pickaxe animation (same as other actions)
- **Duration**: 10 seconds (CONFIG.ACTIONS.HARVEST_LOG_DURATION)
- **Catch Success Rate**: Net quality = catch percentage
  - Q100 net = 100% catch success
  - Q50 net = 50% catch success
  - Q10 net = 10% catch success
  - On failure: No fish caught, no net durability loss, still has cooldown
- **Result** (on success):
  - Generate random base fish quality (10-100)
  - Calculate final fish quality: `baseFishQuality * (netQuality / 100)`
  - Calculate fish durability: `Math.floor(30 * (fishQuality / 100))`
  - Calculate net durability loss: `Math.ceil((10 * fishQuality) / netQuality)`
  - Add fish to inventory (if room available)
  - Reduce net durability (only on success)
  - Start harvest cooldown (3 seconds)

## Implementation Plan (Step-by-Step)

### Phase 1: Configuration & Assets
**Goal:** Add fishing net to market and verify assets exist

1. **✅ VERIFIED: Textures already exist in `public/items/`**
   - [x] net.png
   - [x] Rnet.png
   - [x] fish.png
   - [x] Rfish.png

   Note: Items use `./items/${item.type}.png` path, not `./terrain/`

2. **Add to `public/config.js` - Market Prices**
   ```javascript
   // In CONFIG.MARKET.PRICES, add under Tools section (line ~527):
   fishingnet: { buyPrice: 100, sellPrice: 70, minQuantity: 0, maxQuantity: 20 },
   ```

3. **Add Fish to Market**
   ```javascript
   // In CONFIG.MARKET.PRICES, add under Food section (line ~521):
   fish: { buyPrice: 15, sellPrice: 10, minQuantity: 0, maxQuantity: 150 },
   ```
   Note: `cookedfish` already exists, this adds raw `fish`

4. **Add Fishing Action Duration** (optional - can reuse existing)
   ```javascript
   // In CONFIG.ACTIONS, add:
   FISHING_DURATION: 10000,  // 10 seconds (or reuse HARVEST_LOG_DURATION)
   ```

### Phase 2: Shore/Water Detection System
**Goal:** Detect when player is on shore (land adjacent to water)

4. **Add to `public/core/GameState.js`** (line ~32, after nearestObject)
   ```javascript
   // Add new property to track shore proximity for fishing
   this.nearWater = false;        // True when on shore near water
   this.waterDirection = null;    // Direction to water from player (for facing)
   ```

5. **Update `public/game.js` - Add shore detection in `checkProximityToObjects()`**

   Add this after the existing proximity checks (around line 1531):

   ```javascript
   // Check if player is on shore (for fishing)
   // Player must be on land (not in water) but have water nearby
   const playerHeight = this.terrainRenderer.getTerrainHeightAt(
       this.playerObject.position.x,
       this.playerObject.position.z
   );

   this.gameState.nearWater = false;

   // Only check for water if player is on land
   if (playerHeight >= CONFIG.WATER.LEVEL) {
       // Sample points in a circle around player to find water
       const checkRadius = 0.75; // Same as other interaction radius
       const numSamples = 8; // Check 8 directions around player

       for (let i = 0; i < numSamples; i++) {
           const angle = (i / numSamples) * Math.PI * 2;
           const checkX = this.playerObject.position.x + Math.cos(angle) * checkRadius;
           const checkZ = this.playerObject.position.z + Math.sin(angle) * checkRadius;

           const checkHeight = this.terrainRenderer.getTerrainHeightAt(checkX, checkZ);

           // Found water nearby!
           if (checkHeight < CONFIG.WATER.LEVEL) {
               this.gameState.nearWater = true;
               this.gameState.waterDirection = angle; // Store direction to water
               break;
           }
       }
   }
   ```

   Alternative simpler approach (check forward direction only):
   ```javascript
   // Simpler: Just check if water is in front of player
   const playerHeight = this.terrainRenderer.getTerrainHeightAt(
       this.playerObject.position.x,
       this.playerObject.position.z
   );

   if (playerHeight >= CONFIG.WATER.LEVEL) {
       // Check 0.75 units in front of player
       const checkDistance = 0.75;
       const checkX = this.playerObject.position.x + Math.sin(this.playerObject.rotation.y) * checkDistance;
       const checkZ = this.playerObject.position.z + Math.cos(this.playerObject.rotation.y) * checkDistance;
       const checkHeight = this.terrainRenderer.getTerrainHeightAt(checkX, checkZ);

       this.gameState.nearWater = (checkHeight < CONFIG.WATER.LEVEL);
   } else {
       this.gameState.nearWater = false;
   }
   ```

### Phase 3: Fishing Action System
**Goal:** Implement fishing mechanics in ResourceManager

6. **Update `public/systems/ResourceManager.js`**

   a. Add to `hasRequiredTool()` method:
   ```javascript
   // Add water to tool requirements (around line 509)
   if (objectType === 'water') {
       requiredTool = 'fishingnet';
   }
   ```

   b. Create `startFishingAction()` method (similar to `startHarvestAction()`):
   ```javascript
   startFishingAction() {
       // Check cooldown
       // Validate fishingnet with durability > 0
       // Face the water (optional, or face forward)
       // Set activeAction with actionType: 'fishing'
       // Play pickaxe animation (reuse existing)
       // Duration: CONFIG.ACTIONS.HARVEST_LOG_DURATION (10 seconds)
       // Broadcast to peers
   }
   ```

   c. Create `handleFishCaught()` method (similar to `handleOwnHarvest()`):
   ```javascript
   handleFishCaught(baseFishQuality) {
       // Find fishing net in inventory
       // Calculate final fish quality: baseFishQuality * (netQuality / 100)
       // Calculate net durability loss: (10 * fishQuality) / netQuality
       // Apply durability, check if net broke
       // Create fish item with calculated quality
       // Add to inventory
       // Start cooldown
   }
   ```

   d. Create `createFishItem()` method:
   ```javascript
   createFishItem(fishQuality) {
       return {
           id: `fish_${Date.now()}_${Math.random()}`,
           type: 'fish',
           x: -1, y: -1,
           width: 1, height: 1,
           rotation: 0,
           quality: fishQuality,
           durability: Math.floor(30 * (fishQuality / 100))
       };
   }
   ```

### Phase 4: UI Integration
**Goal:** Add fishing button to UI

7. **Update `public/ui.js`**
   - Add fishing button HTML (if not already in client.html)
   - Update `updateButtonStates()` to accept `nearestWater` parameter
   - Show/hide fishing button based on water proximity + net availability

8. **Update `public/game.js` - Action handling**
   - In action completion section, handle `actionType: 'fishing'`
   - Call `completeFishingAction()` when timer completes
   - Similar to how chopping/harvesting is handled

### Phase 5: Server-Side (Optional - Can be Client-Only Initially)
**Goal:** Add server validation for fishing

9. **Update `server.js`** (if multiplayer validation needed)
   - Handle `fishing_request` message
   - Generate random base fish quality (10-100)
   - Send back `fish_caught` with quality
   - Track fishing to prevent exploits

   OR: Keep it client-only like tree chopping (no server state for fish)

### Phase 6: Testing & Polish
**Goal:** Test and refine

10. **Test scenarios:**
    - [ ] Buy fishing net from market
    - [ ] Walk to water, verify fishing button appears
    - [ ] Use fishing net, verify 10-second action
    - [ ] Verify fish appears in inventory with correct quality/durability
    - [ ] Test net durability loss with different fish qualities
    - [ ] Test net breaking
    - [ ] Test cooldown system
    - [ ] Test with inventory full

11. **Polish:**
    - [ ] Add fishing sound effect (optional, can reuse existing)
    - [ ] Test with other players (multiplayer)
    - [ ] Balance fish quality range if needed

## Questions to Resolve

1. ✅ **Net Durability Loss**: RESOLVED - Uses universal system `(10 * fishQuality) / netQuality`

2. ✅ **Fish Quality Formula**: RESOLVED - `baseFishQuality * (netQuality / 100)`

3. **Base Fish Quality Range**: What should the random range be for base fish quality?
   - Option A: 10-100 (full range, like trees/rocks)
   - Option B: 50-100 (only decent to excellent fish)
   - Option C: 30-90 (centered range with variation)
   - **Recommendation**: Option A (10-100) for consistency with other resources

4. **Fishing Location**: Any water or specific depth requirements?
   - Current plan: Any water (height < 1.02)
   - Alternative: Require deeper water (height < 0.5 or lower)
   - **Recommendation**: Start with any water, can add depth requirements later

5. **Fish Purpose**: What is fish durability used for?
   - Likely: Food system (spoilage timer or food value)
   - Raw fish vs cooked fish? (see cookedfish in market prices)
   - **Needs clarification from user**

6. **Visual Feedback**: Should there be any visual effect when fishing?
   - Ripples in water?
   - Splash animation when fish is caught?
   - **Recommendation**: Defer to later enhancement, start with basic functionality

7. **Fishing Net Textures**: Need net.png and Rnet.png files
   - **Action required**: Create or obtain these image files

## Files to Modify Summary
1. `public/config.js` - Add market prices and tool settings
2. `public/systems/ResourceManager.js` - Add fishing mechanics
3. `public/game.js` - Add water proximity detection
4. `public/ui.js` - Add fishing button
5. `public/core/GameState.js` - Add nearestWater tracking
6. `server.js` - Add server-side fishing handling
7. `public/terrain/` - Add net.png and Rnet.png textures
