# Time Tracking System Documentation

## Overview

The Time Tracking System is a centralized, modular approach to handling all server-side time-based mechanics. It consolidates multiple intervals into two efficient buckets (1-minute and 10-minute) to reduce server load while maintaining game functionality.

## Architecture

### Core Components

1. **TimeTrackerService** (`server/TimeTrackerService.js`)
   - Central service managing all time-based operations
   - Two interval buckets: 1 minute and 10 minutes
   - Error handling and performance monitoring

2. **MessageHandlers Integration** (`server/MessageHandlers.js`)
   - Houses all game-specific time-based logic
   - Registers handlers with TimeTrackerService
   - Provides helper methods like `getActiveChunks()`

## How to Add New Time-Based Features

### Step 1: Choose Your Interval

Decide which interval bucket your feature belongs in:

- **1-minute interval**: For features that need frequent updates
  - Examples: Resource depletion, growth systems, cooking, AI updates
  - Use when: Players would notice delays longer than 1 minute

- **10-minute interval**: For features that can update less frequently
  - Examples: Resource spawning, weather changes, market price updates
  - Use when: Updates are nice-to-have but not time-critical

### Step 2: Create Your Handler Method

Add your handler method to `MessageHandlers.js`:

```javascript
/**
 * Process your feature logic
 * Called by TimeTrackerService every [1/10] minute(s)
 */
processMyFeature() {
    try {
        // Use active chunks for optimization
        const activeChunks = this.getActiveChunks();

        for (const chunkId of activeChunks) {
            const chunkData = this.chunkManager.loadChunk(chunkId);
            if (!chunkData) continue;

            // Your feature logic here
            let modified = false;
            const updates = [];

            // Process objects in chunk
            for (const obj of chunkData.objectChanges || []) {
                if (obj.action === 'add' && obj.type === 'your_type') {
                    // Process this object
                    // Update state
                    // Track changes
                    modified = true;
                    updates.push({ id: obj.id, /* changes */ });
                }
            }

            // Save if modified
            if (modified) {
                this.chunkManager.saveChunk(chunkId, chunkData);

                // Broadcast updates to players
                if (updates.length > 0) {
                    this.messageRouter.broadcastTo3x3Grid(chunkId, {
                        type: 'your_update_message',
                        payload: { chunkId, updates }
                    });
                }
            }
        }
    } catch (error) {
        console.error('ERROR in processMyFeature:', error);
    }
}
```

### Step 3: Register Your Handler

In the `MessageHandlers` constructor, register your handler:

```javascript
// For 1-minute interval
this.timeTracker.registerMinuteHandler('myFeature', () => this.processMyFeature());

// OR for 10-minute interval
this.timeTracker.registerTenMinuteHandler('myFeature', () => this.processMyFeature());
```

### Step 4: Add Client-Side Handler (if needed)

If your feature sends updates to clients, add a handler in `public/network/MessageRouter.js`:

1. Add to the handlers object:
```javascript
'your_update_message': (payload) => this.handleYourUpdate(payload),
```

2. Create the handler method:
```javascript
handleYourUpdate(payload) {
    const { updates } = payload;

    for (const update of updates) {
        const object = this.findObjectById(update.id);
        if (object) {
            // Apply visual updates
            // Update object properties
            // Trigger animations
        }
    }
}
```

## Examples

### Example 1: Weather System (10-minute interval)

```javascript
// In MessageHandlers.js

processWeatherChanges() {
    try {
        // Pick random weather
        const weatherTypes = ['sunny', 'cloudy', 'rainy', 'foggy'];
        const newWeather = weatherTypes[Math.floor(Math.random() * weatherTypes.length)];

        // Save to global state
        this.currentWeather = newWeather;

        // Broadcast to all connected clients
        for (const [clientId, client] of this.clients) {
            client.ws.send(JSON.stringify({
                type: 'weather_update',
                payload: { weather: newWeather }
            }));
        }

        console.log(`[WEATHER] Changed to ${newWeather}`);
    } catch (error) {
        console.error('ERROR in processWeatherChanges:', error);
    }
}

// In constructor
this.timeTracker.registerTenMinuteHandler('weather', () => this.processWeatherChanges());
```

### Example 2: Crop Growth (1-minute interval)

```javascript
// In MessageHandlers.js

processCropGrowth() {
    try {
        const activeChunks = this.getActiveChunks();

        for (const chunkId of activeChunks) {
            const chunkData = this.chunkManager.loadChunk(chunkId);
            if (!chunkData?.objectChanges) continue;

            let modified = false;
            const updates = [];

            for (const obj of chunkData.objectChanges) {
                if (obj.action === 'add' && obj.type === 'crop' && obj.growthStage < 3) {
                    // Advance growth stage
                    obj.growthStage++;
                    modified = true;
                    updates.push({
                        id: obj.id,
                        growthStage: obj.growthStage
                    });

                    if (obj.growthStage === 3) {
                        console.log(`[CROPS] Crop ${obj.id} fully grown!`);
                    }
                }
            }

            if (modified) {
                this.chunkManager.saveChunk(chunkId, chunkData);

                if (updates.length > 0) {
                    this.messageRouter.broadcastTo3x3Grid(chunkId, {
                        type: 'crop_growth_update',
                        payload: { chunkId, updates }
                    });
                }
            }
        }
    } catch (error) {
        console.error('ERROR in processCropGrowth:', error);
    }
}

// In constructor
this.timeTracker.registerMinuteHandler('cropGrowth', () => this.processCropGrowth());
```

### Example 3: Market Price Fluctuation (10-minute interval)

```javascript
// In MessageHandlers.js

processMarketPrices() {
    try {
        // Update prices for all markets
        const loadedChunks = this.chunkManager.getCachedChunkIds();

        for (const chunkId of loadedChunks) {
            const chunkData = this.chunkManager.loadChunk(chunkId);
            if (!chunkData?.objectChanges) continue;

            for (const obj of chunkData.objectChanges) {
                if (obj.action === 'add' && obj.name === 'market') {
                    // Initialize price multiplier if needed
                    if (!obj.priceMultiplier) {
                        obj.priceMultiplier = 1.0;
                    }

                    // Fluctuate prices ±10%
                    const change = (Math.random() - 0.5) * 0.2;
                    obj.priceMultiplier = Math.max(0.5, Math.min(1.5,
                        obj.priceMultiplier + change));

                    console.log(`[MARKET] ${obj.id} price multiplier: ${obj.priceMultiplier.toFixed(2)}`);
                }
            }

            this.chunkManager.saveChunk(chunkId, chunkData);
        }
    } catch (error) {
        console.error('ERROR in processMarketPrices:', error);
    }
}

// In constructor
this.timeTracker.registerTenMinuteHandler('marketPrices', () => this.processMarketPrices());
```

## Best Practices

### 1. Use Timestamp-Based Logic

For features that need sub-minute precision, store timestamps and check elapsed time:

```javascript
// Store start time when action begins
obj.startedAt = Date.now();

// Check in your minute handler
const elapsed = Date.now() - obj.startedAt;
if (elapsed >= requiredDuration) {
    // Complete the action
}
```

### 2. Batch Operations

When spawning multiple items or making multiple changes:

```javascript
// GOOD - Spawn multiple items per cycle
for (let i = 0; i < itemsPerCycle; i++) {
    // Spawn item
}

// BAD - Running more frequently than needed
// Don't use 1-minute interval for something that could be 10-minute
```

### 3. Use Active Chunks

Always prefer `getActiveChunks()` over `getCachedChunkIds()` for better performance:

```javascript
// GOOD - Only process chunks with players
const activeChunks = this.getActiveChunks();

// LESS EFFICIENT - Processes all loaded chunks
const loadedChunks = this.chunkManager.getCachedChunkIds();
```

### 4. Handle Errors Gracefully

Always wrap your handler in try-catch:

```javascript
processMyFeature() {
    try {
        // Your logic
    } catch (error) {
        console.error('ERROR in processMyFeature:', error);
        // Don't let one error break the entire time system
    }
}
```

### 5. Rate Conversion

When migrating from different intervals, adjust rates accordingly:

```javascript
// Old: 1 durability every 2 seconds
// New: X durability every 60 seconds
// Calculation: (60 / 2) * 1 = 30 durability per minute

// Old: Spawn 1 item every 5 minutes
// New: Spawn X items every 10 minutes
// Calculation: (10 / 5) * 1 = 2 items per 10 minutes
```

### 6. Logging

Use descriptive log prefixes for easy debugging:

```javascript
console.log(`[FEATURE_NAME] Action completed for ${objectId}`);
console.log(`[TREE GROWTH] Processed ${treesCount} trees`);
console.log(`[COOKING] ${itemsCooked} items cooked this cycle`);
```

## Advanced Patterns

### Pattern 1: Staggered Processing

To spread load across minutes, use modulo operations:

```javascript
processStaggeredFeature() {
    const minute = Math.floor(Date.now() / 60000) % 10;

    // Process 1/10th of objects each minute
    for (const obj of objects) {
        if (obj.id.hashCode() % 10 === minute) {
            // Process this object
        }
    }
}
```

### Pattern 2: Dynamic Intervals

For features that need variable timing:

```javascript
processVariableFeature() {
    const now = Date.now();

    for (const obj of objects) {
        if (!obj.nextUpdate || now >= obj.nextUpdate) {
            // Process object

            // Set next update time based on conditions
            if (obj.priority === 'high') {
                obj.nextUpdate = now + 60000; // 1 minute
            } else {
                obj.nextUpdate = now + 600000; // 10 minutes
            }
        }
    }
}
```

### Pattern 3: Bulk Updates

For efficiency, collect all updates before broadcasting:

```javascript
processBulkFeature() {
    const updatesByChunk = new Map();

    // Collect all updates
    for (const chunkId of activeChunks) {
        const updates = [];
        // ... process and collect updates
        if (updates.length > 0) {
            updatesByChunk.set(chunkId, updates);
        }
    }

    // Send all updates at once
    for (const [chunkId, updates] of updatesByChunk) {
        this.messageRouter.broadcastTo3x3Grid(chunkId, {
            type: 'bulk_update',
            payload: { chunkId, updates }
        });
    }
}
```

## Debugging

### Check Handler Registration

In `server.js` or debugging console:

```javascript
console.log('Minute handlers:', messageHandlers.timeTracker.minuteHandlers.keys());
console.log('Ten-minute handlers:', messageHandlers.timeTracker.tenMinuteHandlers.keys());
```

### Monitor Performance

The TimeTrackerService logs warnings when handlers take too long:

```
Minute handlers took 6234ms to process 5 handlers
```

If you see this, optimize your handler or move it to the 10-minute interval.

### Test Intervals

For testing, temporarily modify intervals in TimeTrackerService:

```javascript
// Change from 60 * 1000 to 5 * 1000 for 5-second testing
setInterval(() => { /* minute handlers */ }, 5 * 1000);
```

Remember to change back for production!

## Migration Guide

### Migrating from setInterval

1. Remove the old interval setup
2. Move logic to a method in MessageHandlers
3. Register with TimeTrackerService
4. Adjust rates if interval changed

### Migrating from setTimeout

1. Store timestamp when action starts
2. Check elapsed time in minute handler
3. Complete action when duration reached
4. Remove from tracking when complete

## Production Systems

### Cooking System (Campfire & House)

**Server Components:**
- `CookingSystem.js` - Manages cooking operations for campfires and houses
- Transforms raw items to cooked items (fish → cookedfish, meat → cookedmeat)
- Duration: 10 seconds per item
- Requires firewood in inventory

**Time Tracking Integration:**
- `firewood` handler - Depletes firewood in campfires every minute (30 per minute)
- `houseFirewood` handler - Depletes firewood in houses every minute (30 per minute)
- `cooking` handler - Processes active cooking operations for both structure types

**Progress Tracking:**
- Items store `cookingStartTime` timestamp when cooking begins
- Server cancels and clears timestamp if:
  - Item is removed from structure
  - Firewood depletes before completion
  - Processing fails for any reason
- Client displays orange progress bar (10s duration)
- Progress persists through server restarts (stored in database)

**Smoke Effects:**
- **Campfire**: Single smoke source at structure center
- **House**: Single smoke source at y=1, x=0.25 offset (chimney position)
- Smoke controlled by firewood presence in both cases

**Message Flow:**
1. Player adds cookable item + firewood to campfire/house
2. Server starts cooking, adds `cookingStartTime` to item
3. Broadcasts `crate_inventory_updated` with timestamp
4. Client renders progress bar, updates every frame
5. After 10s, server transforms item, removes timestamp
6. Client shows completed item
7. Firewood depletes continuously, broadcasts `campfire_firewood_updated` or `house_firewood_updated`

### Tileworks Processing System

**Server Components:**
- `TileworksSystem.js` - Manages clay to tile conversion
- Transforms clay → tile
- Duration: 60 seconds (1 minute) per item
- Requires firewood in tileworks inventory
- Quality: Averages clay quality with tileworks structure quality

**Time Tracking Integration:**
- `tileworksFirewood` handler - Depletes firewood every minute (30 per minute)
- `tileworksProcessing` handler - Processes active operations

**Progress Tracking:**
- Items store `processingStartTime` timestamp when processing begins
- Server cancels and clears timestamp if:
  - Item is removed from tileworks
  - Firewood depletes before completion
  - Processing fails for any reason
- Client displays green progress bar (60s duration)
- Progress persists through server restarts (stored in database)
- Tileworks smoke (2 chimneys) controlled by firewood presence

**Message Flow:**
1. Player adds clay + firewood to tileworks
2. Server starts processing, adds `processingStartTime` to item
3. Broadcasts `crate_inventory_updated` with timestamp
4. Client renders progress bar, updates every frame
5. After 60s, server transforms item with averaged quality
6. Client shows completed tile

**Quality Calculation:**
```javascript
// Tile quality = average of clay and tileworks structure
const tileQuality = Math.round((clayQuality + tileworksQuality) / 2);
```

### Progress Bar Implementation

**Client-Side (InventoryUI.js):**

```javascript
// Progress bar added during item rendering
if (item.cookingStartTime || item.processingStartTime) {
    const startTime = item.cookingStartTime || item.processingStartTime;
    const duration = item.cookingStartTime ? 10000 : 60000;
    const elapsed = Date.now() - startTime;
    const progress = Math.min(1.0, elapsed / duration);

    // Orange bar for cooking, green bar for tileworks
    const color = item.cookingStartTime ? '#ff9800' : '#4caf50';

    // Render progress bar at bottom of item
    // Updated every frame from game loop
}
```

**Edge Case Handling:**
- Item removed → Progress bar disappears with item
- Firewood depletes → Server clears timestamp, client removes progress bar
- Inventory closed/reopened → Progress resumes from stored timestamp
- Server restart → Timestamp persists in database, progress continues
- Multiple items → Each tracked independently with own timestamp

**Visual Feedback:**
- 6px tall progress bar at bottom of item
- Semi-transparent black background
- Smooth linear animation via CSS transition
- Non-blocking (pointer-events: none)
- Auto-refreshes when complete

## Summary

The Time Tracking System provides:
- **Centralized management** of all time-based features
- **Better performance** through consolidated intervals
- **Easy extensibility** via simple handler registration
- **Consistent patterns** for common time-based operations
- **Built-in optimization** with active chunk processing
- **Robust progress tracking** with edge case handling

To add a new feature:
1. Create handler method in MessageHandlers.js
2. Register with appropriate interval
3. Add client handler if needed
4. Test and adjust rates as necessary