# Plan: Fix Wall Snap Pivot Rotation

## Problem
When placing a wall snapped to another wall's endpoint, rotating with Q/E works initially, but if the mouse moves even slightly afterward, the wall jumps back to an incorrect position.

## Root Cause
The cache in `findWallSnapPlacement()` only uses mouse position (X/Z) as the cache key. Rotation is ignored. When:
1. User snaps wall at rotation 0°
2. User rotates to 90° (pivot works correctly via `recalculateHeightForRotation`)
3. Mouse moves slightly (within 0.3 unit threshold)
4. Cache returns stale result calculated for rotation 0°
5. Stale position overwrites the correct pivoted position

## Solution
Add rotation to the cache key in `findWallSnapPlacement()`.

## Changes Required

### File: `public/world/StructureManager.js`

**1. Add `lastRotation` to cache initialization** (around line 70-73 where wallSnapCache is defined)
- Add `lastRotation: null` to the cache object

**2. Include rotation in cache check** (lines 486-491)
- Add rotation comparison to the `withinThreshold` check
- Cache should invalidate if rotation changes

**3. Store rotation in cache** (lines 584-587)
- Add `cache.lastRotation = rotationDeg` when caching result

## Estimated Changes
- ~5 lines modified in `StructureManager.js`
- No other files need changes
