-- Migration: Fingerprint-Based Player Tracking
-- Run this migration before deploying server changes

-- 1. Add fingerprint column to audit_log
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_fingerprint VARCHAR(64);

-- 2. Index for efficient queries by fingerprint
CREATE INDEX IF NOT EXISTS idx_audit_log_fingerprint ON audit_log(actor_fingerprint);

-- 3. Composite index for fingerprint + time range queries
CREATE INDEX IF NOT EXISTS idx_audit_log_fp_time ON audit_log(actor_fingerprint, ts DESC);

-- 4. Create fingerprint_sightings table for tracking connections
CREATE TABLE IF NOT EXISTS fingerprint_sightings (
    fingerprint_hash VARCHAR(64) PRIMARY KEY,
    partial_hashes JSONB,
    first_seen TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW(),
    connection_count INT DEFAULT 1,
    associated_accounts UUID[],
    associated_names TEXT[]
);

-- 5. Index for finding stale sightings (data retention cleanup)
CREATE INDEX IF NOT EXISTS idx_fp_sightings_last_seen ON fingerprint_sightings(last_seen DESC);
