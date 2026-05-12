# Arena Tracker — Full Project Plan for Claude Code

> Load this file at the start of your Claude Code session.
> It contains everything needed to build the app from scratch.
> Work through each phase in order. Ask for clarification before starting a phase if anything is unclear.

---

## What we're building

A passive, read-only desktop app that tracks a player's League of Legends Arena (queue ID 1700) game history. It pulls data from the Riot Games API after games finish, stores everything locally in SQLite, and displays rich stats with real game icons in an Electron UI window.

**Key constraints:**
- Zero interaction with the game client — purely reads post-game data from Riot's API
- Fully local — no cloud, no server, no accounts
- Shareable — packaged as a single .exe friends can download and run
- Each user supplies their own free Riot developer API key

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Backend | Python 3.11+ | API calls, parsing, SQLite, asset caching |
| Database | SQLite (via `sqlite3` stdlib) | Zero config, single file, portable |
| Frontend | Electron + HTML/CSS/JS | Native window, web-based UI, cross-platform |
| Charts | Chart.js (CDN) | Easy, beautiful, no build step |
| Icons | Data Dragon + Community Dragon | Official Riot CDNs, free |
| Packaging | PyInstaller + Electron Builder | Single .exe output |
| HTTP bridge | Flask (local only, 127.0.0.1) | Python serves data to Electron |

---

## Folder structure

Build this exact structure:

```
ArenaTracker/
├── ARENA_TRACKER_PLAN.md        ← this file
├── README.md
├── requirements.txt
├── package.json                 ← Electron app config
│
├── backend/
│   ├── main.py                  ← entry point, starts Flask + poller
│   ├── api.py                   ← Riot API calls (rate-limited)
│   ├── parser.py                ← match JSON → structured data
│   ├── database.py              ← SQLite schema + queries
│   ├── analytics.py             ← stat computations
│   ├── assets.py                ← Data Dragon + Community Dragon downloader
│   ├── poller.py                ← background sync loop
│   └── server.py                ← Flask routes (REST API for Electron)
│
├── frontend/
│   ├── main.js                  ← Electron main process
│   ├── preload.js               ← Electron preload (context bridge)
│   └── renderer/
│       ├── index.html           ← app shell
│       ├── style.css            ← global styles
│       ├── app.js               ← router + state
│       ├── pages/
│       │   ├── dashboard.js
│       │   ├── history.js
│       │   ├── augments.js
│       │   ├── champions.js
│       │   ├── items.js
│       │   └── graphs.js
│       └── components/
│           ├── gameCard.js
│           ├── augmentChip.js
│           ├── itemRow.js
│           └── champIcon.js
│
├── assets/                      ← cached icons (created at runtime)
│   ├── champions/
│   ├── items/
│   └── augments/
│
└── dist/                        ← built .exe goes here
```

---

## Phase 1 — Backend foundation

### 1.1 Database schema (`backend/database.py`)

Create these tables in `arena_tracker.db`:

```sql
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT UNIQUE NOT NULL,
    game_date TEXT NOT NULL,
    champion_id INTEGER NOT NULL,
    champion_name TEXT NOT NULL,
    placement INTEGER NOT NULL,          -- 1-8
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    damage_dealt INTEGER DEFAULT 0,
    damage_taken INTEGER DEFAULT 0,
    gold_earned INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    duo_partner TEXT,                    -- summoner name of partner
    patch TEXT,                          -- e.g. "15.8"
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS augments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    augment_id INTEGER NOT NULL,
    augment_name TEXT NOT NULL,
    tier TEXT NOT NULL,                  -- "silver", "gold", "prismatic"
    slot INTEGER NOT NULL                -- 1, 2, or 3 (which round it was picked)
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    slot INTEGER NOT NULL                -- inventory slot 0-6
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_cache (
    asset_type TEXT NOT NULL,            -- "champion", "item", "augment"
    asset_id TEXT NOT NULL,
    local_path TEXT NOT NULL,
    patch TEXT NOT NULL,
    PRIMARY KEY (asset_type, asset_id)
);
```

Write helper functions:
- `init_db()` — creates tables if not exist
- `save_game(game_data)` — inserts game + augments + items atomically
- `get_games(limit, offset, filters)` — paginated game list
- `get_game_by_match_id(match_id)` — check if already stored
- `get_champion_stats()` — avg placement, win rate, game count per champ
- `get_augment_stats()` — avg placement per augment across all games
- `get_item_stats()` — frequency and avg placement per item
- `get_placement_trend(last_n)` — list of placements over last N games
- `get_settings()` / `save_settings(key, value)`

### 1.2 Riot API client (`backend/api.py`)

Implement with rate limiting (20 req/s dev key, back off on 429):

```python
class RiotAPI:
    BASE_URLS = {
        "na1": "https://na1.api.riotgames.com",
        "euw1": "https://euw1.api.riotgames.com",
        "kr": "https://kr.api.riotgames.com",
        # add others as needed
    }
    REGIONAL_URLS = {
        "na1": "https://americas.api.riotgames.com",
        "euw1": "https://europe.api.riotgames.com",
        "kr": "https://asia.api.riotgames.com",
    }
```

Methods needed:
- `get_account_by_riot_id(game_name, tag_line)` → puuid
- `get_summoner_by_puuid(puuid)` → summoner data
- `get_arena_match_ids(puuid, start, count)` → list of match IDs (queue=1700)
- `get_match(match_id)` → full match JSON
- `get_current_patch()` → latest patch string from Data Dragon versions endpoint

Handle errors gracefully: 401 (bad key), 403 (forbidden), 404 (not found), 429 (rate limit — wait and retry), 500+ (Riot outage — log and skip).

### 1.3 Match parser (`backend/parser.py`)

The Riot match JSON for Arena is complex. Extract for the correct participant (matched by puuid):

```python
def parse_arena_match(match_json, puuid):
    # Find participant
    participant = next(p for p in match_json["info"]["participants"] if p["puuid"] == puuid)
    
    return {
        "match_id": match_json["metadata"]["matchId"],
        "game_date": datetime.fromtimestamp(match_json["info"]["gameStartTimestamp"] / 1000).isoformat(),
        "champion_id": participant["championId"],
        "champion_name": participant["championName"],
        "placement": participant["placement"],
        "kills": participant["kills"],
        "deaths": participant["deaths"],
        "assists": participant["assists"],
        "damage_dealt": participant["totalDamageDealtToChampions"],
        "damage_taken": participant["totalDamageTaken"],
        "gold_earned": participant["goldEarned"],
        "duration_seconds": match_json["info"]["gameDuration"],
        "duo_partner": get_duo_partner(match_json, puuid),
        "patch": match_json["info"]["gameVersion"].rsplit(".", 1)[0],  # "15.8" from "15.8.123.456"
        "augments": parse_augments(participant),
        "items": parse_items(participant),
    }
```

For augments — Arena uses `playerAugment1` through `playerAugment4` fields. Map augment IDs to names using Community Dragon's augments JSON.

For items — use `item0` through `item6` fields. Filter out 0 (empty slot).

### 1.4 Asset downloader (`backend/assets.py`)

On startup and when patch changes, download icons:

**Data Dragon base URL:** `https://ddragon.leagueoflegends.com`

```python
DDRAGON_BASE = "https://ddragon.leagueoflegends.com"
CDRAGON_BASE = "https://raw.communitydragon.org/latest"

def download_champion_icons(patch):
    # GET /cdn/{patch}/data/en_US/champion.json  → champion list
    # GET /cdn/{patch}/img/champion/{ChampionName}.png  → icon per champ
    # Save to assets/champions/{champion_id}.png

def download_item_icons(patch):
    # GET /cdn/{patch}/data/en_US/item.json  → item list  
    # GET /cdn/{patch}/img/item/{item_id}.png  → icon per item
    # Save to assets/items/{item_id}.png

def download_augment_icons():
    # GET from Community Dragon:
    # https://raw.communitydragon.org/latest/cdragon/arena/en_us.json
    # Each augment has an "iconLargeAssetPath" field
    # Build URL: CDRAGON_BASE + iconLargeAssetPath (lowercase the path)
    # Save to assets/augments/{augment_id}.png

def get_icon_path(asset_type, asset_id):
    # Returns local file path for use in frontend img src
    # Falls back to a placeholder if icon not cached
```

Cache everything — only re-download when patch version changes or file is missing.

### 1.5 Background poller (`backend/poller.py`)

```python
class ArenaPoller:
    def __init__(self, api, db, interval_seconds=120):
        self.api = api
        self.db = db
        self.interval = interval_seconds
        self.running = False
    
    def sync(self):
        # 1. Get last 20 Arena match IDs from Riot
        # 2. For each ID not already in DB:
        #    a. Fetch full match JSON
        #    b. Parse it
        #    c. Save to DB
        # 3. Update "last_synced" in settings
        # 4. Emit sync event to frontend via SSE or websocket
    
    def start(self):
        # Run sync() in a background thread on interval
        # Don't block main thread
```

### 1.6 Flask server (`backend/server.py`)

Local REST API on `http://127.0.0.1:5173` (or any free port, store in settings):

```
GET  /api/status          → { syncing, last_synced, game_count, patch }
GET  /api/games           → paginated game list with icons paths
GET  /api/games/:id       → single game detail
GET  /api/stats/champions → per-champion aggregates
GET  /api/stats/augments  → per-augment aggregates
GET  /api/stats/items     → per-item aggregates
GET  /api/stats/trend     → placement over time (last N games)
GET  /api/assets/:type/:id → serve icon file (or 404)
POST /api/settings        → save { api_key, summoner_name, region, etc }
GET  /api/settings        → load settings
POST /api/sync            → trigger manual sync
```

All responses are JSON. Icon images are served as binary from the assets folder.

### 1.7 Entry point (`backend/main.py`)

```python
if __name__ == "__main__":
    # 1. init_db()
    # 2. load settings
    # 3. If no API key → start in setup mode (Flask only, no poller)
    # 4. Else:
    #    a. Download/verify assets in background thread
    #    b. Start ArenaPoller in background thread
    #    c. Start Flask server (blocking)
```

---

## Phase 2 — Frontend (Electron)

### 2.1 Electron setup (`frontend/main.js`)

```javascript
const { app, BrowserWindow, ipcMain } = require('electron')

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',  // cleaner on Mac
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
        },
        icon: 'assets/app-icon.png'
    })
    win.loadFile('renderer/index.html')
}

// Wait for Python backend to be ready before showing window
// Poll http://127.0.0.1:5173/api/status until it responds
```

### 2.2 Design system (`frontend/renderer/style.css`)

Color palette — League of Legends inspired but clean and modern:

```css
:root {
    --bg-primary: #0a0e1a;        /* deep navy */
    --bg-secondary: #111827;      /* dark card bg */
    --bg-tertiary: #1a2235;       /* elevated surfaces */
    --border: rgba(255,255,255,0.08);
    --text-primary: #e8eaf6;
    --text-secondary: #8b92a5;
    --accent-gold: #c89b3c;       /* LoL gold */
    --accent-blue: #4a90d9;
    --placement-1: #c89b3c;       /* gold */
    --placement-2: #b0bec5;       /* silver */
    --placement-3: #cd7f32;       /* bronze */
    --placement-bad: #4a4a5a;     /* 5-8 */
    --prismatic: #a67bf5;
    --gold-aug: #c89b3c;
    --silver-aug: #8b92a5;
}
```

Font: Use `Inter` (Google Fonts CDN) or system sans-serif fallback.

### 2.3 App shell (`frontend/renderer/index.html`)

Single-page app with sidebar navigation and a main content area. No page reloads — swap content via JS.

Sidebar nav items (with icons):
- Dashboard (home icon)
- Game History (list icon)
- Augments (sparkle icon)
- Champions (sword icon)
- Items (shield icon)
- Graphs (chart icon)
- Settings (gear icon)

Add a sync status indicator at the bottom of the sidebar: green dot + "Synced X min ago" or spinning indicator when syncing.

### 2.4 Pages

#### Dashboard (`pages/dashboard.js`)
- Top row: 4 stat cards — Avg Placement, Top 4 Rate, Win Rate (#1), Games Tracked
- Recent games table (last 10): champ icon, placement badge, augment chips with icons, KDA, damage bar, date
- Mini placement trend sparkline (last 20 games)

#### Game History (`pages/history.js`)
- Filterable, sortable table of all games
- Filters: champion (dropdown), placement range, date range, patch
- Each row expands to show full augment build + item row with icons
- Export to CSV button

#### Augments (`pages/augments.js`)
- Grid of all augments you've taken, each as a card:
  - Augment icon (from Community Dragon)
  - Augment name
  - Times taken
  - Avg placement badge (color-coded)
  - Tier indicator (silver/gold/prismatic border color)
- Filter by tier, sort by avg placement or times taken
- Click augment → show all games where it was taken

#### Champions (`pages/champions.js`)
- Grid of champion cards (only champs you've played):
  - Champion splash icon
  - Name
  - Games played
  - Avg placement
  - Best placement
  - Win rate
- Click champion → show filtered game history + best augment combos for that champ

#### Items (`pages/items.js`)
- Similar grid to augments but for items
- Show frequency (how often built), avg placement when in inventory
- Group by category (boots, mythic, legendary, component)

#### Graphs (`pages/graphs.js`)
All charts via Chart.js:
- **Placement over time** — line chart, last 50 games, with patch boundary markers
- **Placement distribution** — bar chart (how many 1st, 2nd, 3rd... 8th place finishes)
- **Top 4 rate by champion** — horizontal bar chart (only champs with 3+ games)
- **Damage dealt distribution** — histogram
- **Augment tier heatmap** — which tier augments correlate with better placements
- **Time of day performance** — polar area chart (do you play better in morning vs evening?)

#### Settings (`pages/settings.js`)
First-run setup wizard + settings page:
- Riot API key input (masked, with "Test connection" button)
- Summoner name + tagline (e.g. `PlayerName#NA1`)
- Region dropdown
- Sync frequency slider (1 min – 30 min)
- Data folder location
- "Sync now" button
- "Clear all data" button (with confirmation)

---

## Phase 3 — Asset integration details

### Icon display pattern

Always show icons from the local asset cache, never directly from CDN at runtime:

```javascript
// In renderer — fetch icon URL from backend
function getChampionIcon(championId) {
    return `http://127.0.0.1:5173/api/assets/champion/${championId}`
}

function getItemIcon(itemId) {
    return `http://127.0.0.1:5173/api/assets/item/${itemId}`
}

function getAugmentIcon(augmentId) {
    return `http://127.0.0.1:5173/api/assets/augment/${augmentId}`
}

// Usage in HTML
img.src = getChampionIcon(championId)
img.onerror = () => img.src = 'fallback-icon.png'  // always have fallback
```

### Augment tier visual treatment

```css
/* Prismatic augment chip */
.augment-chip.prismatic {
    border: 1px solid var(--prismatic);
    background: rgba(166, 123, 245, 0.15);
}

/* Gold augment chip */
.augment-chip.gold {
    border: 1px solid var(--gold-aug);
    background: rgba(200, 155, 60, 0.15);
}

/* Silver augment chip */
.augment-chip.silver {
    border: 1px solid var(--silver-aug);
    background: rgba(139, 146, 165, 0.1);
}
```

### Placement badge colors

```css
.placement[data-rank="1"] { background: var(--placement-1); color: #1a1200; }
.placement[data-rank="2"] { background: var(--placement-2); color: #1a1a1a; }
.placement[data-rank="3"] { background: var(--placement-3); color: #1a0a00; }
.placement[data-rank="4"] { background: #4a6a3a; color: #e8eaf6; }  /* top 4 but not podium */
/* 5-8: var(--placement-bad) */
```

---

## Phase 4 — Packaging & distribution

### 4.1 Python backend packaging

`requirements.txt`:
```
flask==3.0.0
flask-cors==4.0.0
requests==2.31.0
schedule==1.2.1
Pillow==10.2.0
```

Build command:
```bash
pyinstaller --onefile --name arena-backend backend/main.py
```

This produces `dist/arena-backend.exe` (Windows) or `dist/arena-backend` (Mac/Linux).

### 4.2 Electron packaging

`package.json` key fields:
```json
{
  "name": "arena-tracker",
  "version": "1.0.0",
  "main": "frontend/main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "build": {
    "appId": "com.arenatracker.app",
    "productName": "Arena Tracker",
    "extraResources": [
      { "from": "dist/arena-backend.exe", "to": "arena-backend.exe" }
    ],
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" }
  }
}
```

Electron's `main.js` spawns the bundled Python backend as a child process on startup, then opens the window once `/api/status` responds.

### 4.3 Distribution checklist

Before sharing with friends:
- [ ] Test fresh install on a clean machine (no Python, no Node)
- [ ] Verify first-run setup wizard works
- [ ] Test with a dev API key (not personal production key)
- [ ] Confirm icons load correctly
- [ ] Test sync with real Arena game data
- [ ] Check that the app exits cleanly (kills backend process on window close)

---

## Phase 5 — Nice-to-haves (build after core is working)

- **Live game overlay** (separate window that shows your current augment choices as you pick — still read-only, uses spectator API or just monitors match-in-progress endpoint)
- **Friend comparison** — enter a friend's summoner name and compare stats side by side
- **Patch notes diff** — highlight augments/items that changed in the latest patch
- **Best augment recommender** — "for your champ, these augment combos have your best avg placement"
- **Export as image** — screenshot a game card to share on Discord
- **Dark/light theme toggle**
- **Tray icon** — minimize to system tray, sync runs silently in background

---

## Development order (stick to this)

1. `database.py` — schema + all query functions (test with dummy data)
2. `api.py` — Riot API client (test with real key + summoner name)
3. `parser.py` — match parser (test with one real match JSON)
4. `assets.py` — icon downloader (verify icons save correctly)
5. `poller.py` — background sync (verify games appear in DB)
6. `server.py` — Flask REST API (verify with curl/Postman)
7. `main.py` — wire everything together
8. `frontend/main.js` — Electron shell
9. `renderer/index.html` + `style.css` — app shell + nav
10. `pages/dashboard.js` — first visible page
11. `pages/history.js`
12. `pages/augments.js`
13. `pages/champions.js`
14. `pages/items.js`
15. `pages/graphs.js`
16. `pages/settings.js`
17. Packaging + distribution testing

---

## Important notes for Claude Code

- **Never read game memory, inject DLLs, or interact with the running game client.** Read-only Riot API calls only.
- **Rate limit all API calls.** Dev key is 20 req/1s and 100 req/2min. Use a token bucket or simple sleep between calls.
- **All data stays local.** No telemetry, no analytics, no external servers except Riot API + Data Dragon CDN.
- **The Electron renderer and Python backend communicate only via HTTP on localhost.** No direct IPC for data — keep it clean.
- **Handle the case where the user has no Arena games yet** — show a friendly empty state, not an error.
- **Gracefully handle API key expiry** — dev keys expire after 24 hours. Detect 401 responses and prompt the user to refresh their key in settings.
- **Test icon fallbacks** — some augments may not have icons in Community Dragon yet. Always show a placeholder rather than a broken image.
- **Arena queue ID is 1700.** Always filter match history to this queue only.
- **Augment IDs in the match JSON use `playerAugment1`–`playerAugment4`.** Map these IDs to names using the Community Dragon augments JSON at `https://raw.communitydragon.org/latest/cdragon/arena/en_us.json`.

---

## Quick reference — key API endpoints

```
# Get PUUID from Riot ID
GET https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}

# Get match list (Arena = queue 1700)  
GET https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=1700&count=20

# Get full match
GET https://americas.api.riotgames.com/lol/match/v5/matches/{matchId}

# Current patch
GET https://ddragon.leagueoflegends.com/api/versions.json  (first element = latest)

# Champion data
GET https://ddragon.leagueoflegends.com/cdn/{patch}/data/en_US/champion.json

# Item data
GET https://ddragon.leagueoflegends.com/cdn/{patch}/data/en_US/item.json

# Augment data (Community Dragon)
GET https://raw.communitydragon.org/latest/cdragon/arena/en_us.json

# Champion icon
GET https://ddragon.leagueoflegends.com/cdn/{patch}/img/champion/{championName}.png

# Item icon
GET https://ddragon.leagueoflegends.com/cdn/{patch}/img/item/{itemId}.png
```

All requests need header: `X-Riot-Token: {api_key}`

---

*End of plan. Start with Phase 1.1 — database.py.*
