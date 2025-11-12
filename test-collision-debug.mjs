// Test collision detection for touching vs overlapping rectangles
import { Bounds2D, CollisionManager } from './public/Collision2D.js';

console.log('=== Testing Rectangle Collision Detection ===\n');

// Test 1: Touching edge-to-edge (should NOT collide with <=)
const market = new Bounds2D('rectangle', 0, 0, 2.0, 8.0, 0);
const garden_touching = new Bounds2D('rectangle', 1.5, 0, 1.0, 1.0, 0);

console.log('Test 1: Market (2x8 at x=0) vs Garden (1x1 at x=1.5)');
console.log('  Market edge: x =', 0 + 2.0/2, '(center 0 + half-width 1)');
console.log('  Garden edge: x =', 1.5 - 1.0/2, '(center 1.5 - half-width 0.5)');
console.log('  Gap:', (1.5 - 1.0/2) - (0 + 2.0/2));
console.log('  Collision detected:', market.intersects(garden_touching));
console.log('  Expected: false (touching edge-to-edge)\n');

// Test 2: Slight overlap (should collide)
const garden_overlap = new Bounds2D('rectangle', 1.49, 0, 1.0, 1.0, 0);

console.log('Test 2: Market (2x8 at x=0) vs Garden (1x1 at x=1.49)');
console.log('  Market edge: x =', 0 + 2.0/2);
console.log('  Garden edge: x =', 1.49 - 1.0/2);
console.log('  Gap:', (1.49 - 1.0/2) - (0 + 2.0/2));
console.log('  Collision detected:', market.intersects(garden_overlap));
console.log('  Expected: true (overlapping)\n');

// Test 3: Small gap (should NOT collide)
const garden_gap = new Bounds2D('rectangle', 1.51, 0, 1.0, 1.0, 0);

console.log('Test 3: Market (2x8 at x=0) vs Garden (1x1 at x=1.51)');
console.log('  Market edge: x =', 0 + 2.0/2);
console.log('  Garden edge: x =', 1.51 - 1.0/2);
console.log('  Gap:', (1.51 - 1.0/2) - (0 + 2.0/2));
console.log('  Collision detected:', market.intersects(garden_gap));
console.log('  Expected: false (small gap)\n');

// Test with CollisionManager
console.log('=== Testing with CollisionManager ===\n');
const cm = new CollisionManager();

// Register market
cm.register('market1', market);

console.log('Registered market at (0, 0) with size 2x8');

// Test garden placement at different positions
const positions = [
    { x: 1.5, desc: 'touching edge-to-edge' },
    { x: 1.49, desc: 'slight overlap' },
    { x: 1.51, desc: 'small gap' },
    { x: 1.75, desc: 'larger gap' }
];

for (const pos of positions) {
    const testGarden = new Bounds2D('rectangle', pos.x, 0, 1.0, 1.0, 0);
    const collision = cm.checkCollision(testGarden);
    console.log(`Garden at x=${pos.x} (${pos.desc}):`, collision ? 'BLOCKED' : 'ALLOWED');
}
