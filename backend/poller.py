import threading
import time
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class ArenaPoller:
    def __init__(self, api, db_module, interval_seconds=120):
        self.api = api
        self.db = db_module
        self.interval = interval_seconds
        self.running = False
        self._thread = None
        self.status = {
            "syncing": False,
            "last_synced": None,
            "last_error": None,
            "new_games": 0,
        }
        self._puuid = None
        self._callbacks = []

    def set_puuid(self, puuid):
        self._puuid = puuid

    def on_sync_complete(self, callback):
        self._callbacks.append(callback)

    def _notify(self, event_type, data=None):
        for cb in self._callbacks:
            try:
                cb(event_type, data)
            except Exception as e:
                logger.warning(f"Callback error: {e}")

    def _fetch_and_save_matches(self, match_ids):
        from backend.parser import parse_arena_match
        new_count = 0
        for match_id in match_ids:
            if self.db.get_game_by_match_id(match_id):
                continue
            try:
                match_json = self.api.get_match(match_id)
                game_data = parse_arena_match(match_json, self._puuid)
                self.db.save_game(game_data)
                new_count += 1
                logger.info(f"Saved new game: {match_id}")
            except Exception as e:
                logger.warning(f"Failed to process {match_id}: {e}")
        return new_count

    def backfill(self):
        """Fetch all historical Arena games, paginating until Riot returns nothing new."""
        if not self._puuid:
            return 0

        self.status["syncing"] = True
        self.status["backfilling"] = True
        self._notify("backfill_start")
        total_new = 0
        start = 0
        batch_size = 100

        logger.info("Starting full history backfill...")
        try:
            while True:
                match_ids = self.api.get_arena_match_ids(self._puuid, start=start, count=batch_size)
                if not match_ids:
                    break
                new_in_batch = self._fetch_and_save_matches(match_ids)
                total_new += new_in_batch
                self._notify("backfill_progress", {"fetched": start + len(match_ids), "new": total_new})
                # If every match in this batch was already stored, no need to go further back
                if new_in_batch == 0 and start > 0:
                    break
                if len(match_ids) < batch_size:
                    break
                start += batch_size

            self.db.save_setting("backfill_complete", "1")
            self._notify("backfill_complete", {"new_games": total_new})
            logger.info(f"Backfill complete: {total_new} games saved")
        except Exception as e:
            self.status["last_error"] = str(e)
            self._notify("sync_error", {"error": str(e)})
            logger.error(f"Backfill failed: {e}")
        finally:
            self.status["syncing"] = False
            self.status["backfilling"] = False

        return total_new

    def sync(self):
        if not self._puuid:
            settings = self.db.get_settings()
            self._puuid = settings.get("puuid")
        if not self._puuid:
            logger.warning("No PUUID configured, skipping sync")
            return 0

        self.status["syncing"] = True
        self._notify("sync_start")
        new_count = 0

        try:
            match_ids = self.api.get_arena_match_ids(self._puuid, start=0, count=20)
            new_count = self._fetch_and_save_matches(match_ids)
            self.status["last_synced"] = datetime.now().isoformat()
            self.status["new_games"] = new_count
            self.status["last_error"] = None
            self.db.save_setting("last_synced", self.status["last_synced"])
            self._notify("sync_complete", {"new_games": new_count})
            logger.info(f"Sync complete: {new_count} new games")
        except Exception as e:
            self.status["last_error"] = str(e)
            self._notify("sync_error", {"error": str(e)})
            logger.error(f"Sync failed: {e}")
        finally:
            self.status["syncing"] = False

        return new_count

    def _run_loop(self):
        while self.running:
            try:
                self.sync()
            except Exception as e:
                logger.error(f"Poller loop error: {e}")
            for _ in range(self.interval * 10):
                if not self.running:
                    break
                time.sleep(0.1)

    def start(self):
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._start_with_backfill, daemon=True)
        self._thread.start()
        logger.info(f"Poller started with {self.interval}s interval")

    def _start_with_backfill(self):
        settings = self.db.get_settings()
        if not settings.get("backfill_complete"):
            self.backfill()
        self._run_loop()

    def stop(self):
        self.running = False
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("Poller stopped")
