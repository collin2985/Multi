class NavigationWorkerClient {
    constructor() {
        this.worker = null;
        this.pendingRequests = new Map();
        this.nextRequestId = 0;
        this.REQUEST_TIMEOUT = 10000;
        this._restarting = false;
        this.onRestarted = null; // Callback for NavigationManager to re-sync chunks
    }

    async initialize() {
        const cacheBust = localStorage.getItem('serverVersion') || Date.now();
        const workerPath = `./workers/NavigationWorker.js?v=${cacheBust}`;
        try {
            // Try to fetch the worker script first to see if it exists
            const testFetch = await fetch(workerPath);
            if (!testFetch.ok) {
                console.error('[NavigationWorkerClient] Worker script not found or error:', testFetch.status);
            }

            this.worker = new Worker(workerPath);
            this.worker.onmessage = this._onMessage.bind(this);
            this.worker.onerror = (e) => {
                console.error('[NavigationWorkerClient] Worker error event:', e);
                console.error('[NavigationWorkerClient] Error message:', e.message);
                console.error('[NavigationWorkerClient] Error filename:', e.filename);
                console.error('[NavigationWorkerClient] Error lineno:', e.lineno);
                this._onError(e);
            };
            this._restarting = false;
        } catch (e) {
            console.error('[NavigationWorkerClient] Failed to create worker:', e);
            throw e;
        }
    }

    registerChunk(chunkId, chunkX, chunkZ, grid, worldOriginX, worldOriginZ, version) {
        if (!this.worker || this._restarting) {
            console.error(`[NavDiag] registerChunk SKIP ${chunkId} | worker=${!!this.worker} restarting=${this._restarting}`);
            return;
        }
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
            type: 'update_chunk',
            chunkId,
            grid: gridCopy.buffer
        }, [gridCopy.buffer]);
    }

    findPath(startX, startZ, goalX, goalZ, options = {}) {
        if (!this.worker || this._restarting) return Promise.resolve(null);
        return new Promise((resolve) => {
            const requestId = this.nextRequestId++;

            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                if (requestId < 10) {
                    console.warn(`[NavigationWorkerClient] Path request #${requestId} timed out`);
                }
                resolve(null);
            }, this.REQUEST_TIMEOUT);

            this.pendingRequests.set(requestId, { resolve, timeoutId });

            this.worker.postMessage({
                type: 'find_path',
                requestId,
                startX, startZ, goalX, goalZ,
                maxIterations: options.maxIterations || 5000,
                ignoreSlopes: options.ignoreSlopes || false
            });
        });
    }

    _onMessage(e) {
        if (e.data.type === 'path_result') {
            const pending = this.pendingRequests.get(e.data.requestId);
            if (pending) {
                clearTimeout(pending.timeoutId);
                this.pendingRequests.delete(e.data.requestId);
                pending.resolve(e.data.path);
            }
        }
    }

    _onError(error) {
        console.error('[NavigationWorker] Error:', error);
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeoutId);
            pending.resolve(null);
        }
        this.pendingRequests.clear();
        this._scheduleRestart();
    }

    _scheduleRestart() {
        if (this._restarting) return;
        this._restarting = true;
        console.error('[NavigationWorkerClient] Scheduling worker restart in 1s');
        setTimeout(async () => {
            try {
                await this.initialize();
                console.error('[NavigationWorkerClient] Worker restarted successfully');
                if (this.onRestarted) {
                    this.onRestarted();
                }
            } catch (e) {
                console.error('[NavigationWorkerClient] Worker restart failed:', e);
                this._restarting = false;
            }
        }, 1000);
    }
}

let instance = null;
export function getNavigationWorker() { return instance; }
export async function initializeNavigationWorker() {
    instance = new NavigationWorkerClient();
    await instance.initialize();
    return instance;
}
