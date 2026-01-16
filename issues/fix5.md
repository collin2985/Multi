# Performance Issues - Server Logging, AI Spawning, Cheating Detection

## CRITICAL

### Issue 1: Synchronous File I/O in AuditLogger
**File:** `server/AuditLogger.js:283`
`fs.appendFileSync()` in flush path blocks the entire event loop during file writes. With high log volume (inventory saves, harvests, chunk entries), this causes latency spikes for all players.

### Issue 2: Unbounded spawnerStates Map Growth
**File:** `server/AISpawnerSystem.js`
`spawnerStates` Map never cleans up - entries persist indefinitely. Over weeks of runtime with hundreds of structures, this is unbounded memory growth.

### Issue 3: Console Logging Every Tick in AI Spawner
**File:** `server/AISpawnerSystem.js:45-117`
Multiple `console.log()` calls execute every tick in the update loop. Console.log is synchronous blocking I/O in the hot path.

---

## HIGH

### Issue 4: Redundant Structure Type Checks
**File:** `server/MessageHandlers.js:3049-3158`
Structure type checked 15+ times per inventory save message (sequential string comparisons in a critical hot path).

### Issue 5: Expensive Inventory Validation
**File:** `server/MessageHandlers.js:1159-1198`
`validateCrateInventory()` runs 600+ operations (6 parseInt calls x up to 100 items) synchronously on every inventory save.

### Issue 6: Excessive Concurrent Database Lookups
**File:** `server/MessageHandlers.js:214-302`
`Promise.all()` spawns 100+ concurrent database lookups per chunk transition for owner enrichment.

### Issue 7: Unoptimized Tick Broadcasting
**File:** `server.js:109-112`
Tick message broadcasted to ALL clients every second with no filtering or message reuse.

### Issue 8: Expensive Chunk Eviction
**File:** `server.js:115-127`
Chunk eviction runs O(players x cache_size x radius^2) every 60 seconds, blocking the server.

---

## MEDIUM

### Issue 9: Buffer Growth on Flush Failure
**File:** `server/AuditLogger.js:237`
On flush failure, entries concatenated back to buffer - repeated failures cause unbounded buffer growth.

### Issue 10: Expensive JSON Serialization in Flush
**File:** `server/AuditLogger.js:282`
`JSON.stringify()` called 100 times per flush + string join - expensive serialization in flush path.

### Issue 11: Full Chunk Scan Every Tick
**File:** `server/AISpawnerSystem.js`
`getActiveChunkIds()` scans all cached chunks every tick even when most are empty.

### Issue 12: Array Allocation on AI Death
**File:** `server/AISpawnerSystem.js`
`state.activeAI.filter()` creates new array on every AI death (GC pressure).

### Issue 13: Sequential Awaits in Disconnect Cleanup
**File:** `server/MessageHandlers.js:1696-1794`
Sequential awaits in disconnect cleanup - 10-20 blocking awaits per player disconnect.

### Issue 14: Nested Loop Chunk Scan on Disconnect
**File:** `server/MessageHandlers.js:2937-2955`
Nested loop scans all cached chunks on disconnect for lock release.

### Issue 15: Redundant Proximity Calculations
**File:** `server/Broadcaster.js:198-218`
Notification queue recalculates player proximity every 100ms with redundant iterations.

### Issue 16: Synchronous Console Logging Throughout
**File:** `server.js` (166 instances)
Synchronous `console.log` calls scattered throughout hot paths can block event loop.

---

## DESIGN OBSERVATIONS

### Issue 17: High Audit Log Frequency
**File:** `server/AuditLogger.js`
Logs chunk entry, inventory open/save, and harvest - these are normal gameplay events generating 400-600 entries per minute with 20 players.

### Issue 18: Synchronous Fallback on DB Failure
**File:** `server/ChunkStore.js:110`
Fallback to `fs.writeFileSync()` on database failure - full event loop block in error path.

---

## Summary by System

| System | Critical Issues |
|--------|-----------------|
| AuditLogger | #1, #9, #10, #17 |
| AISpawnerSystem | #2, #3, #11, #12 |
| MessageHandlers | #4, #5, #6, #13, #14 |
| server.js | #7, #8, #16 |
| Broadcaster | #15 |
| ChunkStore | #18 |
