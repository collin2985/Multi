# Horses Game - Project Rules

## Read First (Every Session)
Before starting work, read these files for context:
1. **GAME_CONTEXT.md** - Architecture, systems, current state
2. **CODEFILE_GUIDE.md** - File locations and organization

## Rules

### File Navigation
- Use CODEFILE_GUIDE.md to locate files. Do not grep/search blindly unless you can't find what you're looking for.

### Code Reuse
- Use existing code systems before implementing new systems unless it will cause the file to be over 20k tokens or impact performance.

### Performance
- Be PERFORMANCE MINDED - this is a real-time multiplayer game.
- Server should be used as a last resort. Keep as much stuff client-side as possible to reduce strain on server.

### Style
- No emojis in text in the game.

### File Size Limits
- Keep code files under 2000 lines (including existing ones).
- Keep GAME_CONTEXT.md under 20k tokens.
- Keep CODEFILE_GUIDE.md mindful of file size.

### Documentation Updates
- Document changes in GAME_CONTEXT.md if you changed something important.
- After adding, renaming, or deleting code files, update CODEFILE_GUIDE.md following the format in its "Maintaining This Guide" section.
