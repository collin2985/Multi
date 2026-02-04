/**
 * PathfindingScheduler.js
 * FIFO fair queue dispatching pathfinding requests across multiple web workers.
 * Ensures no single AI entity can starve others by monopolizing the pathfinder.
 */

const WORKER_COUNT = 3;
const REQUEST_TIMEOUT = 12000; // 12s (slightly over worker's 10s internal timeout)

class WorkerHandle {
    // Wraps a single NavigationWorker web worker
    constructor(id) {
        this.id = id;
        this.worker = null;
        this.busy = false;           // true when a find_path is in-flight
        this.currentRequest = null;  // {requestId, resolve, timeoutId}
        this.nextRequestId = 0;
        this._restarting = false;
    }

    async initialize() {
        const cacheBust = localStorage.getItem('serverVersion') || Date.now();
        const workerPath = `./workers/NavigationWorker.js?v=${cacheBust}`;
        this.worker = new Worker(workerPath);
        this.worker.onmessage = this._onMessage.bind(this);
        this.worker.onerror = this._onError.bind(this);
        this._restarting = false;
        this.onRequestComplete = null; // Callback to scheduler
        this.onNeedRestart = null;     // Callback to scheduler
    }

    // Send chunk data to this worker (fire-and-forget)
    registerChunk(chunkId, chunkX, chunkZ, grid, worldOriginX, worldOriginZ, version) {
        if (!this.worker || this._restarting) return;
        const gridCopy = grid.slice();
        this.worker.postMessage({
            type: 'register_chunk',
            chunkId, chunkX, chunkZ, worldOriginX, worldOriginZ,
            version: version || 0,
            grid: gridCopy.buffer
        }, [gridCopy.buffer]);
    }

    unregisterChunk(chunkId) {
        if (!this.worker || this._restarting) return;
        this.worker.postMessage({ type: 'unregister_chunk', chunkId });
    }

    updateChunkGrid(chunkId, grid) {
        if (!this.worker || this._restarting) return;
        const gridCopy = grid.slice();
        this.worker.postMessage({
            type: 'update_chunk', chunkId,
            grid: gridCopy.buffer
        }, [gridCopy.buffer]);
    }

    updateChunkCells(chunkId, changes) {
        if (!this.worker || this._restarting) return;
        this.worker.postMessage({
            type: 'update_cells',
            chunkId,
            changes  // Array of {index, flags}
        });
    }

    // Dispatch a single pathfinding request
    dispatch(startX, startZ, goalX, goalZ, options, resolve) {
        const requestId = this.nextRequestId++;
        this.busy = true;

        const timeoutId = setTimeout(() => {
            this._completeRequest(null);
        }, REQUEST_TIMEOUT);

        this.currentRequest = { requestId, resolve, timeoutId };

        this.worker.postMessage({
            type: 'find_path',
            requestId,
            startX, startZ, goalX, goalZ,
            maxIterations: options.maxIterations || 5000,
            ignoreSlopes: options.ignoreSlopes || false,
            ignoreObstacles: options.ignoreObstacles || false
        });
    }

    _onMessage(e) {
        if (e.data.type === 'path_result') {
            if (this.currentRequest && e.data.requestId === this.currentRequest.requestId) {
                this._completeRequest(e.data.path);
            }
        }
    }

    _completeRequest(path) {
        if (!this.currentRequest) return;
        clearTimeout(this.currentRequest.timeoutId);
        const { resolve } = this.currentRequest;
        this.currentRequest = null;
        this.busy = false;
        resolve(path);
        // Notify scheduler to dispatch next queued request
        if (this.onRequestComplete) this.onRequestComplete(this.id);
    }

    _onError(error) {
        console.error(`[PathfindingScheduler] Worker ${this.id} error:`, error);
        // Resolve current request with null
        if (this.currentRequest) {
            this._completeRequest(null);
        }
        // Request scheduler to restart this worker
        if (this.onNeedRestart) this.onNeedRestart(this.id);
    }
}

export class PathfindingScheduler {
    constructor() {
        this.workers = [];
        this.queue = [];              // FIFO: [{startX, startZ, goalX, goalZ, options, resolve}]
        this._chunkRegistry = new Map(); // chunkId → {chunkId, chunkX, chunkZ, grid, worldOriginX, worldOriginZ, version}
    }

    async initialize() {
        for (let i = 0; i < WORKER_COUNT; i++) {
            const handle = new WorkerHandle(i);
            await handle.initialize();
            handle.onRequestComplete = () => this._dispatchNext();
            handle.onNeedRestart = (id) => this._restartWorker(id);
            this.workers.push(handle);
        }
    }

    // === Pathfinding API (same contract as old NavigationWorkerClient.findPath) ===

    findPath(startX, startZ, goalX, goalZ, options = {}) {
        return new Promise((resolve) => {
            this.queue.push({ startX, startZ, goalX, goalZ, options, resolve });
            this._dispatchNext();
        });
    }

    // === Chunk management (broadcast to all workers) ===

    registerChunk(chunkId, chunkX, chunkZ, grid, worldOriginX, worldOriginZ, version) {
        // Store for restart re-sync (Map prevents duplicates on re-register)
        this._chunkRegistry.set(chunkId, { chunkId, chunkX, chunkZ, grid, worldOriginX, worldOriginZ, version });
        for (const w of this.workers) {
            w.registerChunk(chunkId, chunkX, chunkZ, grid, worldOriginX, worldOriginZ, version);
        }
    }

    unregisterChunk(chunkId) {
        this._chunkRegistry.delete(chunkId);
        for (const w of this.workers) {
            w.unregisterChunk(chunkId);
        }
    }

    updateChunkGrid(chunkId, grid) {
        // Update stored registry entry
        const entry = this._chunkRegistry.get(chunkId);
        if (entry) entry.grid = grid;
        for (const w of this.workers) {
            w.updateChunkGrid(chunkId, grid);
        }
    }

    updateChunkCells(chunkId, changes) {
        // Update local registry
        const entry = this._chunkRegistry.get(chunkId);
        if (entry) {
            for (const { index, flags } of changes) {
                entry.grid[index] = flags;
            }
        }
        // Send to all workers
        for (const w of this.workers) {
            w.updateChunkCells(chunkId, changes);
        }
    }

    // === Internal dispatch logic ===

    _dispatchNext() {
        if (this.queue.length === 0) return;

        // Find an idle worker
        const idle = this.workers.find(w => !w.busy && !w._restarting);
        if (!idle) return; // All workers busy — request stays queued

        const request = this.queue.shift();
        idle.dispatch(
            request.startX, request.startZ,
            request.goalX, request.goalZ,
            request.options, request.resolve
        );
    }

    async _restartWorker(id) {
        const handle = this.workers[id];
        if (handle._restarting) return;
        handle._restarting = true;
        console.error(`[PathfindingScheduler] Restarting worker ${id} in 1s`);

        setTimeout(async () => {
            try {
                await handle.initialize();
                handle.onRequestComplete = () => this._dispatchNext();
                handle.onNeedRestart = (wid) => this._restartWorker(wid);
                // Re-sync all chunks to restarted worker
                for (const c of this._chunkRegistry.values()) {
                    handle.registerChunk(c.chunkId, c.chunkX, c.chunkZ,
                        c.grid, c.worldOriginX, c.worldOriginZ, c.version);
                }
                console.error(`[PathfindingScheduler] Worker ${id} restarted, ${this._chunkRegistry.size} chunks synced`);
                // Dispatch queued requests to the now-available worker
                this._dispatchNext();
            } catch (e) {
                console.error(`[PathfindingScheduler] Worker ${id} restart failed:`, e);
                handle._restarting = false;
            }
        }, 1000);
    }

    // === Debug ===

    getStats() {
        return {
            queueLength: this.queue.length,
            workers: this.workers.map(w => ({
                id: w.id, busy: w.busy, restarting: w._restarting
            }))
        };
    }
}
