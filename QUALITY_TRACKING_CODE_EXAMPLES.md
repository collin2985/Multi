# Quality Tracking - Detailed Code Examples

## Key Finding
Quality is partially tracked on the client but completely ignored on the server.

---

## 1. WHERE MATERIALS ARE ADDED (Client-Side)

File: C:/Users/colli/Desktop/test Horses/Horses/public/ui/InventoryUI.js
Method: _tryDropOnConstruction(event, item)
Lines: 948-1021

Key code sections:

Line 990-991: Update quantity only
currentMaterials[itemType] = current + 1;
this.gameState.nearestConstructionSite.userData.materials = currentMaterials;

Line 994-998: Store actual item with quality
const nextSlotIndex = this.gameState.nearestConstructionSite.userData.materialItems[itemType].length;
this.gameState.nearestConstructionSite.userData.materialItems[itemType][nextSlotIndex] = {
    type: item.type,
    quality: item.quality    // <-- QUALITY IS CAPTURED HERE
};

Key Points:
- Lines 990-991: Only track QUANTITY in materials object
- Lines 994-998: Track QUALITY in materialItems array
- Line 997: Quality value item.quality is captured
- Client-Side Only: This data exists only in the client THREE.js object, NOT on server

---

## 2. ATTEMPTED SERVER SYNC (Broken)

File: C:/Users/colli/Desktop/test Horses/Horses/public/systems/BuildingSystem.js
Method: addMaterialToConstruction(constructionSite, materialType, amount)
Lines: 245-278

Key code:

Line 271-275: Send update message
this.networkManager.sendMessage('update_construction_materials', {
    constructionId: constructionSite.userData.objectId,
    chunkKey: constructionSite.userData.chunkKey,
    materials: current  // <-- ONLY SENDS QUANTITIES, NO QUALITY
});

Critical Issue:
- Line 274: Message sends only quantities like {limestone: 5}
- Missing server handler: No handler for update_construction_materials exists!

---

## 3. CONSTRUCTION SITE DATA STRUCTURE

File: C:/Users/colli/Desktop/test Horses/Horses/server/MessageHandlers.js
Method: handlePlaceConstructionSite(payload)
Lines: 211-229

Data structure created:
- requiredMaterials: {oakplank: 1}  (what's needed)
- materials: {}                     (what's been added - JUST QUANTITIES)
- NO quality field in data structure
- materialItems NEVER persisted to server

---

## 4. FINAL QUALITY CALCULATION (The Problem)

File: C:/Users/colli/Desktop/test Horses/Horses/server/MessageHandlers.js
Method: handleBuildConstruction(payload)
Lines: 282-292

Code:
for (const [materialType, quantity] of Object.entries(materials)) {
    totalQuality += 50 * quantity;  // <-- HARDCODED!
    materialCount += quantity;
}

The Problem:
- Uses HARDCODED quality value of 50 for every material
- Ignores the actual quality of each material item
- Multiplies by quantity

Example Scenario:
Player adds limestone with quality 95, 75, 60

Current calculation:
totalQuality = (50 * 3) = 150
structureQuality = 150 / 3 = 50

Actual quality should be: (95+75+60)/3 = 76.67
But calculation gives: 50
Difference: -26.67 quality points lost (26.67% worse)

---

## 5. SERVER MESSAGE ROUTING (Missing Handler)

File: C:/Users/colli/Desktop/test Horses/Horses/server.js
Lines: 44-124

The switch statement has no case for 'update_construction_materials'
Client sends this message but it's logged as "Unknown message type"
Message is completely ignored

---

## Summary

WHAT IS BEING TRACKED:
- Client tracks individual item quality in materialItems array
- Line 997 in InventoryUI.js: quality: item.quality

WHAT IS NOT BEING SYNCED:
- No server handler for update_construction_materials
- MaterialItems array never sent to server
- Quality never persisted in chunk data

WHAT IS NOT BEING CALCULATED:
- Server ignores quality and uses hardcoded 50
- Line 288 in MessageHandlers.js: totalQuality += 50 * quantity

RESULT:
Quality tracking infrastructure exists but is not wired end-to-end.
