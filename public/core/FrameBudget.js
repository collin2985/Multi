/**
 * FrameBudget.js
 * Shared frame budget that all queues consult to prevent stacking.
 * Started once per frame; each queue checks remaining budget before doing work.
 */

const TOTAL_BUDGET_MS = 8.0;

class FrameBudget {
    constructor() {
        this._frameStart = 0;
    }

    beginFrame() {
        this._frameStart = performance.now();
    }

    elapsed() {
        return performance.now() - this._frameStart;
    }

    remaining() {
        return Math.max(0, TOTAL_BUDGET_MS - this.elapsed());
    }

    hasTime(minMs = 0.2) {
        return this.remaining() >= minMs;
    }
}

export const frameBudget = new FrameBudget();
