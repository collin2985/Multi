/**
 * PerformanceTimer.js
 * Utility for timing chunk transition operations to identify stutter sources.
 *
 * Usage:
 *   import { ChunkPerfTimer } from './core/PerformanceTimer.js';
 *   ChunkPerfTimer.start('myOperation');
 *   // ... do work ...
 *   ChunkPerfTimer.end('myOperation');
 *
 * Console commands:
 *   ChunkPerfTimer.enabled = false;  // Disable all timing
 *   ChunkPerfTimer.threshold = 1.0;  // Only log operations > 1ms
 *   ChunkPerfTimer.getSummary();     // Get timing summary
 */

export const ChunkPerfTimer = {
    enabled: false,
    threshold: 0.5, // Only log if > 0.5ms
    times: {},

    // Summary tracking
    summary: {},
    summaryCount: {},

    start(label) {
        if (!this.enabled) return;
        this.times[label] = performance.now();
    },

    end(label) {
        if (!this.enabled || !this.times[label]) return;
        const elapsed = performance.now() - this.times[label];
        delete this.times[label];

        // Track summary
        if (!this.summary[label]) {
            this.summary[label] = 0;
            this.summaryCount[label] = 0;
        }
        this.summary[label] += elapsed;
        this.summaryCount[label]++;

        // Log if above threshold
        if (elapsed > this.threshold) {
            console.log(`[PERF] ${label}: ${elapsed.toFixed(2)}ms`);
        }

        return elapsed;
    },

    // Log immediately without start/end pattern
    log(label, elapsed) {
        if (!this.enabled) return;

        // Track summary
        if (!this.summary[label]) {
            this.summary[label] = 0;
            this.summaryCount[label] = 0;
        }
        this.summary[label] += elapsed;
        this.summaryCount[label]++;

        if (elapsed > this.threshold) {
            console.log(`[PERF] ${label}: ${elapsed.toFixed(2)}ms`);
        }
    },

    // Get summary of all timing data
    getSummary() {
        const results = [];
        for (const label in this.summary) {
            const total = this.summary[label];
            const count = this.summaryCount[label];
            const avg = count > 0 ? total / count : 0;
            results.push({ label, total, count, avg });
        }
        results.sort((a, b) => b.total - a.total);

        console.log('=== CHUNK PERF SUMMARY ===');
        console.table(results.map(r => ({
            Operation: r.label,
            'Total (ms)': r.total.toFixed(2),
            Count: r.count,
            'Avg (ms)': r.avg.toFixed(2)
        })));

        return results;
    },

    // Reset summary
    reset() {
        this.summary = {};
        this.summaryCount = {};
        console.log('[PERF] Summary reset');
    }
};

// Expose globally for console access
window.ChunkPerfTimer = ChunkPerfTimer;
