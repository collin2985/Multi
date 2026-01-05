class NavigationWorkerClient {
    constructor() {
        this.worker = null;
        this.pendingRequests = new Map();
        this.nextRequestId = 0;
        this.REQUEST_TIMEOUT = 10000;
    }

    async initialize() {
        const workerPath = './workers/NavigationWorker.js';
        console.log('[NavigationWorkerClient] Creating worker at', workerPath);
        try {
            // Try to fetch the worker script first to see if it exists
            const testFetch = await fetch(workerPath);
            console.log('[NavigationWorkerClient] Worker script fetch status:', testFetch.status);
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
            console.log('[NavigationWorkerClient] Worker object created');
        } catch (e) {
            console.error('[NavigationWorkerClient] Failed to create worker:', e);
            throw e;
        }
    }

    registerChunk(chunkId, chunkX, chunkZ, grid, worldOriginX, worldOriginZ, version) {
        const gridCopy = grid.slice();
        this.worker.postMessage({
            type: 'register_chunk',
            chunkId, chunkX, chunkZ, worldOriginX, worldOriginZ,
            version: version || 0,
            grid: gridCopy.buffer
        }, [gridCopy.buffer]);
    }

    unregisterChunk(chunkId) {
        this.worker.postMessage({ type: 'unregister_chunk', chunkId });
    }

    findPath(startX, startZ, goalX, goalZ, options = {}) {
        return new Promise((resolve) => {
            const requestId = this.nextRequestId++;

            // Debug: log first few path requests
            if (requestId < 5) {
                console.log(`[NavigationWorkerClient] Path request #${requestId}: (${startX.toFixed(1)},${startZ.toFixed(1)}) -> (${goalX.toFixed(1)},${goalZ.toFixed(1)})`);
            }

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
                maxIterations: options.maxIterations || 2000,
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
                // Debug: log first few responses
                if (e.data.requestId < 5) {
                    const pathLen = e.data.path ? e.data.path.length : 0;
                    console.log(`[NavigationWorkerClient] Path result #${e.data.requestId}: ${pathLen} waypoints`);
                }
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
    }
}

let instance = null;
export function getNavigationWorker() { return instance; }
export async function initializeNavigationWorker() {
    instance = new NavigationWorkerClient();
    await instance.initialize();
    return instance;
}
