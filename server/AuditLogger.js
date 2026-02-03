/**
 * AuditLogger.js
 * Tracks structure and inventory changes for moderation/investigation.
 * Buffered writes - flushes to DB (online) or file (offline) every 60 seconds or 100 entries.
 */

const fs = require('fs');
const path = require('path');

class AuditLogger {
    constructor(db, dbReady) {
        this.db = db;
        this.dbReady = dbReady;
        this.buffer = [];
        this.logDir = './logs';
        this.flushInterval = setInterval(() => this.flush(), 60000);

        if (!dbReady && !fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

    }

    // Action type constants
    static ACTION = {
        STRUCT_ADD: 1,
        STRUCT_REMOVE: 2,
        INV_OPEN: 3,
        INV_SAVE: 4,
        MARKET_BUY: 5,
        MARKET_SELL: 6,
        PLAYER_CONNECT: 7,
        PLAYER_DISCONNECT: 8,
        CHUNK_ENTER: 9,
        HARVEST: 10,
        FINGERPRINT_CHECK: 11,
        FINGERPRINT_BAN: 12
    };

    /**
     * Add entry to buffer
     * @param {object} entry - Log entry
     */
    log(entry) {
        this.buffer.push({
            ts: Date.now(),
            ...entry
        });

        if (this.buffer.length >= 100) {
            this.flush();
        }
    }

    /**
     * Log structure placement
     */
    logStructureAdd(objType, objId, chunkX, chunkZ, actorId, actorAccount, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.STRUCT_ADD,
            obj_type: objType,
            obj_id: objId,
            chunk_x: chunkX,
            chunk_z: chunkZ,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            owner_id: actorAccount || actorId
        });
    }

    /**
     * Log structure removal
     */
    logStructureRemove(objType, objId, chunkX, chunkZ, actorId, actorAccount, ownerId, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.STRUCT_REMOVE,
            obj_type: objType,
            obj_id: objId,
            chunk_x: chunkX,
            chunk_z: chunkZ,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            owner_id: ownerId || null
        });
    }

    /**
     * Log inventory open (player views structure contents)
     */
    logInventoryOpen(objType, objId, chunkX, chunkZ, actorId, actorAccount, ownerId, inventory, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.INV_OPEN,
            obj_type: objType,
            obj_id: objId,
            chunk_x: chunkX,
            chunk_z: chunkZ,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            owner_id: ownerId || null,
            data: inventory
        });
    }

    /**
     * Log inventory save (player modifies structure contents)
     */
    logInventorySave(objType, objId, chunkX, chunkZ, actorId, actorAccount, ownerId, inventory, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.INV_SAVE,
            obj_type: objType,
            obj_id: objId,
            chunk_x: chunkX,
            chunk_z: chunkZ,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            owner_id: ownerId || null,
            data: inventory
        });
    }

    /**
     * Log market purchase
     */
    logMarketBuy(objId, chunkX, chunkZ, actorId, actorAccount, ownerId, itemType, quality, durability, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.MARKET_BUY,
            obj_type: 'market',
            obj_id: objId,
            chunk_x: chunkX,
            chunk_z: chunkZ,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            owner_id: ownerId || null,
            data: { itemType, quality, durability }
        });
    }

    /**
     * Log market sale
     */
    logMarketSell(objId, chunkX, chunkZ, actorId, actorAccount, ownerId, itemType, quality, durability, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.MARKET_SELL,
            obj_type: 'market',
            obj_id: objId,
            chunk_x: chunkX,
            chunk_z: chunkZ,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            owner_id: ownerId || null,
            data: { itemType, quality, durability }
        });
    }

    /**
     * Log player connection
     */
    logConnect(actorId, actorAccount, ipAddress, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.PLAYER_CONNECT,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            data: { ip: ipAddress }
        });
    }

    /**
     * Log player disconnection
     */
    logDisconnect(actorId, actorAccount, lastChunkX, lastChunkZ, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.PLAYER_DISCONNECT,
            chunk_x: lastChunkX ?? null,
            chunk_z: lastChunkZ ?? null,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null
        });
    }

    /**
     * Log chunk entry (player moves to new chunk)
     */
    logChunkEnter(chunkX, chunkZ, actorId, actorAccount, prevChunkX, prevChunkZ, username, fingerprint, extraData) {
        this.log({
            action_type: AuditLogger.ACTION.CHUNK_ENTER,
            chunk_x: chunkX,
            chunk_z: chunkZ,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            data: {
                ...(prevChunkX != null ? { from_x: prevChunkX, from_z: prevChunkZ } : {}),
                ...extraData
            }
        });
    }

    /**
     * Log resource harvest
     */
    logHarvest(objType, objId, chunkX, chunkZ, actorId, actorAccount, remainingResources, username, fingerprint) {
        this.log({
            action_type: AuditLogger.ACTION.HARVEST,
            obj_type: objType,
            obj_id: objId,
            chunk_x: chunkX,
            chunk_z: chunkZ,
            actor_id: actorId,
            actor_account: actorAccount || null,
            actor_name: username || null,
            actor_fingerprint: fingerprint || null,
            data: { remaining: remainingResources }
        });
    }

    /**
     * Flush buffer to storage
     */
    async flush() {
        if (this.buffer.length === 0) return;

        const entries = this.buffer;
        this.buffer = [];

        try {
            if (this.dbReady) {
                await this._flushToDatabase(entries);
            } else {
                await this._flushToFile(entries);
            }
        } catch (error) {
            console.error('[AuditLogger] Flush failed:', error.message);
            // Put entries back in buffer to retry
            this.buffer = entries.concat(this.buffer);
        }
    }

    /**
     * Batch insert to PostgreSQL
     */
    async _flushToDatabase(entries) {
        if (entries.length === 0) return;

        // Build parameterized query for batch insert
        const values = [];
        const params = [];
        let paramIndex = 1;

        for (const e of entries) {
            values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
            params.push(
                e.ts,
                e.action_type,
                e.chunk_x ?? null,
                e.chunk_z ?? null,
                e.obj_type || null,
                e.obj_id || null,
                e.actor_id || null,
                e.actor_account || null,
                e.actor_name || null,
                e.actor_fingerprint || null,
                e.owner_id || null,
                e.data ? JSON.stringify(e.data) : null
            );
        }

        await this.db.query(`
            INSERT INTO audit_log (ts, action_type, chunk_x, chunk_z, obj_type, obj_id,
                                   actor_id, actor_account, actor_name, actor_fingerprint, owner_id, data)
            VALUES ${values.join(', ')}
        `, params);
    }

    /**
     * Append to daily JSONL file (offline mode)
     */
    async _flushToFile(entries) {
        const date = new Date().toISOString().split('T')[0];
        const filePath = path.join(this.logDir, `audit_${date}.jsonl`);
        const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
        await fs.promises.appendFile(filePath, lines);
    }

    /**
     * Cleanup on shutdown
     */
    async close() {
        clearInterval(this.flushInterval);
        await this.flush();
    }
}

module.exports = AuditLogger;
