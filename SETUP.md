# Arena Tracker — Setup Guide

## Requirements

- **Python 3.11+** — [python.org/downloads](https://python.org/downloads)
- **Node.js 18+** — [nodejs.org](https://nodejs.org) (for running the Electron UI)

---

## Quick Start (Development)

### Step 1 — Install Python dependencies
```bash
pip install -r requirements.txt
```

### Step 2 — Install Node.js dependencies
```bash
npm install
```

### Step 3 — Create placeholder assets
```bash
python create_placeholder.py
```

### Step 4 — Start the backend
```bash
python backend/main.py
```
Or double-click `start_backend.bat`

### Step 5 — Start the UI (in a new terminal)
```bash
npx electron .
```
Or double-click `start_dev.bat` to do both at once.

---

## First Run

1. The app will open to the **Settings** page since no API key is configured yet.
2. Get a free Riot Developer API key at [developer.riotgames.com](https://developer.riotgames.com)
   - Log in → copy the **Development API Key** (valid for 24 hours)
3. Enter your:
   - API Key
   - Summoner Name (the part before #)
   - Tag Line (the part after #, e.g. `NA1`)
   - Region
4. Click **Save & Connect**
5. Your recent Arena games will sync automatically!

---

## Building a Shareable .exe

### 1. Build the Python backend
```bash
pip install pyinstaller
pyinstaller --onefile --name arena-backend backend/main.py
```
This creates `dist/arena-backend.exe`

### 2. Build the Electron installer
```bash
npm install
npm run build
```
This creates a Windows installer in `dist-electron/`

### 3. Share
Send your friends the installer from `dist-electron/`. They don't need Python or Node installed!

---

## Notes

- **Dev API keys expire every 24 hours.** Go to Settings and paste a new key when you get a 401 error.
- All data is stored locally in `arena_tracker.db` — nothing is sent to any server.
- Assets (champion/item/augment icons) download automatically on first run (~50MB).
