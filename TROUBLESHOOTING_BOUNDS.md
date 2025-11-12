# Troubleshooting Bounding Box System

## Common Issues & Solutions

### 1. "Cannot read property 'type' of undefined"
**Cause**: Object doesn't have proper bounds
**Solution**: Make sure object has `userData.modelPath` set:
```javascript
myObject.userData.modelPath = 'house.glb';
```

### 2. Objects Still Using Wrong Bounds
**Cause**: Model name mismatch in config
**Check**:
- Look at `ModelBoundsConfig.js`
- Ensure model name matches exactly (e.g., 'market.glb' not 'market')
- Check console for "using AABB temporarily" messages

### 3. Debug Visualization Not Working
**Fix**: Press 'V' key (not 'b') to toggle
**Note**: Must be in game window, not console

### 4. Placement Still Failing
**Debug Steps**:
1. Press 'V' to enable debug mode
2. Look at the color of bounding boxes:
   - Yellow = Problem! Object using expanded AABB
   - Cyan = Good! Object using OBB
3. Check console for collision logs

### 5. Performance Issues
**If game runs slower**:
- OBB calculations are more expensive than AABB
- Consider using AABB for distant objects
- Disable debug visualization ('V' key) when not needed

## Quick Verification

Run this in browser console while game is running:
```javascript
// Check if new system is loaded
console.log('Bounding system:', typeof boundingBoxSystem);
console.log('Debugger:', typeof game.boundingBoxDebugger);

// Test a specific object
const testObj = game.scene.children.find(c => c.userData.modelPath);
if (testObj) {
    const bounds = boundingBoxSystem.getBoundingBox(testObj);
    console.log('Test object bounds type:', bounds.type);
}
```

## Reverting Changes

If you need to temporarily disable the new system:

1. **Disable in StructureManager.js**:
   Comment out new code and uncomment old collision code

2. **Keep visual debugging**:
   The debug system is independent and won't break anything

## Getting Help

1. Check console for error messages
2. Enable debug mode ('V' key) to visualize bounds
3. Look for "COLLISION CHECK" messages in console
4. Test with `test-bounding-boxes.html` to isolate issues

## Performance Monitoring

```javascript
// Add to game loop to monitor collision performance
console.log('Collision stats:', collisionSystem.getStats());
```

This will show:
- Total collision checks per frame
- Broad vs narrow phase checks
- Hit rate percentage