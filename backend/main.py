import os
import sys
import logging
import threading

# Add project root to path
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

def _get_log_dir():
    if os.environ.get('APPDATA'):
        d = os.path.join(os.environ['APPDATA'], 'arena-tracker')
    else:
        d = os.path.join(os.path.expanduser('~'), '.arena-tracker')
    os.makedirs(d, exist_ok=True)
    return d

_log_dir = _get_log_dir()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(_log_dir, "arena_tracker.log"), encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


def main():
    from backend import database as db
    from backend.api import RiotAPI
    from backend.poller import ArenaPoller
    from backend import assets
    from backend.server import app, init_server

    logger.info("Arena Tracker starting...")
    db.init_db()

    settings = db.get_settings()
    api_key = settings.get("api_key", "")
    region = settings.get("region", "na1")
    puuid = settings.get("puuid", "")
    sync_interval = int(settings.get("sync_interval", "120"))

    api = RiotAPI(api_key, region) if api_key else None
    poller = None

    if api_key and puuid:
        logger.info("API key found, starting poller...")
        poller = ArenaPoller(api, db, interval_seconds=sync_interval)
        poller.set_puuid(puuid)

        def start_assets_and_poller():
            try:
                patch = api.get_current_patch()
                db.save_setting("patch", patch)
                assets.download_all_assets(patch)
            except Exception as e:
                logger.warning(f"Asset download failed: {e}")
            poller.start()

        threading.Thread(target=start_assets_and_poller, daemon=True).start()
    else:
        logger.info("No API key configured. Starting in setup mode.")

    init_server(db, api, poller, assets)

    port = int(os.environ.get("ARENA_PORT", "5173"))
    logger.info(f"Flask server starting on port {port}")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
