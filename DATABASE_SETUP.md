# PostgreSQL Database Setup Guide

This guide explains how to set up PostgreSQL for your game server, both locally and on Render.com.

## Why PostgreSQL?

We migrated from JSON files to PostgreSQL because:
- ✅ **Render persistence**: JSON files don't persist on Render's free tier (get wiped on restart)
- ✅ **Scalability**: Handles many concurrent players properly
- ✅ **Data integrity**: ACID compliance prevents data corruption
- ✅ **Better queries**: Can add features like leaderboards, player search, etc.
- ✅ **Future-ready**: Foundation for player authentication and accounts

## Setup on Render.com (Production)

### 1. Create PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"PostgreSQL"**
3. Configure:
   - **Name**: `game-database` (or any name you prefer)
   - **Database**: `game_db`
   - **User**: (auto-generated)
   - **Region**: Same as your web service (for low latency)
   - **Instance Type**: **Free** (or paid for production)
4. Click **"Create Database"**
5. Wait for database to provision (takes 1-2 minutes)

### 2. Connect Web Service to Database

1. Go to your web service in Render Dashboard
2. Click **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Add:
   - **Key**: `DATABASE_URL`
   - **Value**: Click "Insert database URL" → Select your PostgreSQL database → Select "Internal Database URL"
5. Click **"Save Changes"**
6. Your service will automatically redeploy with database connection

### 3. Verify Connection

After deployment, check your server logs in Render:
- Look for: `✓ PostgreSQL connected successfully`
- Look for: `✓ Database schema initialized`
- Look for: `ChunkManager: Database ready`

If you see these messages, you're good to go!

## Setup Locally (Development)

### Option 1: Install PostgreSQL Locally

1. **Install PostgreSQL**:
   - Windows: Download from [postgresql.org](https://www.postgresql.org/download/windows/)
   - Mac: `brew install postgresql@15`
   - Linux: `sudo apt-get install postgresql postgresql-contrib`

2. **Create Database**:
   ```bash
   # Start PostgreSQL service
   # Windows: Service starts automatically
   # Mac: brew services start postgresql@15
   # Linux: sudo service postgresql start

   # Create database
   createdb game_db

   # Or using psql:
   psql postgres
   CREATE DATABASE game_db;
   \q
   ```

3. **Configure Environment**:
   Create a `.env` file in the project root:
   ```env
   DATABASE_URL=postgresql://localhost:5432/game_db
   NODE_ENV=development
   ```

4. **Install dependencies**:
   ```bash
   npm install
   ```

5. **Start server**:
   ```bash
   node server.js
   ```

### Option 2: Use Render PostgreSQL for Development

You can also use your Render PostgreSQL database for local development:

1. Get the **External Database URL** from Render dashboard
2. Create `.env` file:
   ```env
   DATABASE_URL=postgresql://user:pass@host.render.com:5432/database
   NODE_ENV=development
   ```

**Note**: External connections to Render's free PostgreSQL may be slower due to distance.

## How It Works

### Server Changes

The server now uses PostgreSQL instead of JSON files:

1. **ChunkManager** (server/ChunkManager.js):
   - `loadChunk()` - Reads from PostgreSQL (or falls back to JSON files)
   - `saveChunk()` - Writes to PostgreSQL (or falls back to JSON files)
   - All other server code remains unchanged

2. **DatabaseManager** (server/DatabaseManager.js):
   - Handles PostgreSQL connection pooling
   - Auto-creates schema on first run
   - Provides fallback to JSON files if database unavailable

### Migration from JSON Files

The system automatically handles migration:

1. **First load**: If chunk exists in JSON file but not database, loads from file
2. **Save**: All saves go to database (JSON fallback only on error)
3. **Backwards compatible**: Existing JSON files work as fallback

You can safely delete JSON files after confirming database is working.

### Database Schema

```sql
CREATE TABLE chunks (
    chunk_id VARCHAR(50) PRIMARY KEY,  -- "chunk_0,0"
    data JSONB NOT NULL,               -- The entire chunk object
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

Simple schema stores chunks as JSON (JSONB type for efficiency).

## Troubleshooting

### "Database not connected" error

**Cause**: DATABASE_URL not set or invalid

**Fix**:
1. Check `.env` file exists and has correct DATABASE_URL
2. Verify PostgreSQL is running locally
3. Check Render environment variable is set correctly

### Connection timeout

**Cause**: Database unreachable or wrong credentials

**Fix**:
1. Verify DATABASE_URL format: `postgresql://user:pass@host:port/dbname`
2. Check firewall isn't blocking port 5432
3. For Render, use **Internal Database URL** for web service

### "Schema initialization failed"

**Cause**: Database exists but user lacks permissions

**Fix**:
1. Grant permissions: `GRANT ALL PRIVILEGES ON DATABASE game_db TO your_user;`
2. Or create database with correct owner: `CREATE DATABASE game_db OWNER your_user;`

### Server falls back to JSON files

**Cause**: Database connection failed, server uses fallback mode

**Fix**:
1. Check server logs for specific database error
2. Fix database connection issue
3. Restart server - it will retry database connection

## Next Steps

Once PostgreSQL is working:

1. ✅ **Current**: Chunks persist across server restarts
2. 🔜 **Next**: Add player authentication (username/password)
3. 🔜 **Future**: Player inventories, stats, factions, leaderboards

The database foundation is now ready for all these features!

## Testing

Test that database persistence works:

1. Start server locally
2. Join game and make changes (place objects, build structures)
3. Stop server: `Ctrl+C`
4. Start server again: `node server.js`
5. Rejoin game - your changes should still be there!

If changes persist, database is working correctly.
