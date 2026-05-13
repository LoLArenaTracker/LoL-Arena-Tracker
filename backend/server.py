import os
import json
import logging
from datetime import datetime
from flask import Flask, jsonify, request, send_file, Response

logger = logging.getLogger(__name__)

app = Flask(__name__)


@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response


@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    return '', 204


@app.before_request
def log_incoming():
    logger.info(f">>> {request.method} {request.path}")


@app.after_request
def log_outgoing(response):
    logger.info(f"<<< {request.method} {request.path} {response.status_code}")
    return response


@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    tb = traceback.format_exc()
    logger.error(f"EXCEPTION in {request.method} {request.path}: {e}\n{tb}")
    return jsonify({"error": str(e), "traceback": tb}), 500


@app.route("/api/ping")
def ping():
    return jsonify({"ok": True, "db": _db is not None})


_db = None
_api = None
_poller = None
_assets = None
_sse_clients = []


def init_server(db_module, api_instance, poller_instance, assets_module):
    global _db, _api, _poller, _assets
    _db = db_module
    _api = api_instance
    _poller = poller_instance
    _assets = assets_module

    if _poller:
        _poller.on_sync_complete(_broadcast_sync_event)


def _broadcast_sync_event(event_type, data=None):
    msg = f"data: {json.dumps({'event': event_type, 'data': data or {}})}\n\n"
    dead = []
    for q in _sse_clients:
        try:
            q.put(msg)
        except Exception:
            dead.append(q)
    for q in dead:
        _sse_clients.remove(q)


@app.route("/api/status")
def get_status():
    settings = _db.get_settings() if _db else {}
    stats = _db.get_summary_stats() if _db else {}
    poller_status = _poller.status if _poller else {}
    return jsonify({
        "syncing": poller_status.get("syncing", False),
        "backfilling": poller_status.get("backfilling", False),
        "last_synced": settings.get("last_synced"),
        "game_count": stats.get("total_games", 0),
        "patch": settings.get("patch", ""),
        "last_error": poller_status.get("last_error"),
        "configured": bool(settings.get("api_key") and settings.get("puuid")),
    })


@app.route("/api/stats/wins-collection")
def get_wins_collection():
    return jsonify(_db.get_wins_collection(game_mode=request.args.get('game_mode')))


@app.route("/api/stats/champions/<path:champion_name>/games")
def get_champion_games(champion_name):
    games = _db.get_champion_games(champion_name, game_mode=request.args.get('game_mode'))
    return jsonify(games)


@app.route("/api/games")
def get_games():
    limit = min(int(request.args.get("limit", 20)), 100)
    offset = int(request.args.get("offset", 0))
    filters = {
        "champion_name": request.args.get("champion"),
        "placement_min": request.args.get("placement_min"),
        "placement_max": request.args.get("placement_max"),
        "date_from": request.args.get("date_from"),
        "date_to": request.args.get("date_to"),
        "patch": request.args.get("patch"),
    }
    filters = {k: v for k, v in filters.items() if v}
    result = _db.get_games(limit=limit, offset=offset, filters=filters, game_mode=request.args.get('game_mode'))
    return jsonify(result)


@app.route("/api/games/<int:game_id>")
def get_game(game_id):
    game = _db.get_game_detail(game_id)
    if not game:
        return jsonify({"error": "Game not found"}), 404
    return jsonify(game)


@app.route("/api/stats/champions")
def get_champion_stats():
    return jsonify(_db.get_champion_stats(game_mode=request.args.get('game_mode')))


@app.route("/api/stats/augments")
def get_augment_stats():
    return jsonify(_db.get_augment_stats(game_mode=request.args.get('game_mode')))


@app.route("/api/stats/items")
def get_item_stats():
    return jsonify(_db.get_item_stats(game_mode=request.args.get('game_mode')))


@app.route("/api/data/augments")
def get_augment_data():
    import json, re
    data_path = os.path.join(_assets.ASSETS_DIR, "augments_data.json")
    if not os.path.exists(data_path):
        return jsonify({})
    with open(data_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    augments = raw if isinstance(raw, list) else raw.get("augments", [])
    result = {}
    for a in augments:
        aug_id = a.get("id")
        if not aug_id:
            continue
        desc = a.get("desc") or a.get("tooltip") or ""
        desc = re.sub(r'<br\s*/?>', ' ', desc, flags=re.IGNORECASE)
        desc = re.sub(r'<[^>]+>', '', desc)
        desc = re.sub(r'@[^@]+@', '#', desc)
        desc = desc.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
        desc = re.sub(r'\s+', ' ', desc).strip()
        result[str(aug_id)] = {
            "name": a.get("name", ""),
            "desc": desc[:200] + ("…" if len(desc) > 200 else ""),
        }
    return jsonify(result)


@app.route("/api/stats/streak")
def get_streak():
    return jsonify(_db.get_streak(game_mode=request.args.get('game_mode')))


@app.route("/api/stats/best-champion")
def get_best_champion():
    return jsonify(_db.get_best_champion(game_mode=request.args.get('game_mode')) or {})


@app.route("/api/stats/top-damage")
def get_top_damage():
    return jsonify(_db.get_top_damage_games(game_mode=request.args.get('game_mode')))


@app.route("/api/stats/trend")
def get_trend():
    last_n = int(request.args.get("n", 50))
    return jsonify(_db.get_placement_trend(last_n, game_mode=request.args.get('game_mode')))


@app.route("/api/stats/summary")
def get_summary():
    return jsonify(_db.get_summary_stats(game_mode=request.args.get('game_mode')))


@app.route("/api/assets/<asset_type>/<asset_id>")
def get_asset(asset_type, asset_id):
    if not _assets:
        return jsonify({"error": "Assets not initialized"}), 503
    path = _assets.get_icon_path(asset_type, asset_id)
    if path and os.path.exists(path):
        return send_file(path, mimetype="image/png")
    placeholder = _assets.PLACEHOLDER_PATH
    if os.path.exists(placeholder):
        return send_file(placeholder, mimetype="image/png")
    return "", 404


@app.route("/api/settings", methods=["GET"])
def get_settings():
    settings = _db.get_settings()
    safe = {k: v for k, v in settings.items() if k != "api_key"}
    if "api_key" in settings:
        safe["api_key_set"] = True
        safe["api_key_preview"] = settings["api_key"][:8] + "..." if len(settings["api_key"]) > 8 else "***"
    return jsonify(safe)


@app.route("/api/settings", methods=["POST"])
def save_settings():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # Always save settings first regardless of connection outcome
    allowed_keys = ["api_key", "summoner_name", "tag_line", "region", "sync_interval"]
    for key in allowed_keys:
        if key in data:
            _db.save_setting(key, str(data[key]))

    # Attempt to connect and get PUUID
    settings = _db.get_settings()
    api_key = settings.get("api_key", "")
    summoner_name = settings.get("summoner_name", "")
    tag_line = settings.get("tag_line", "")
    region = settings.get("region", "na1")

    if api_key and summoner_name and tag_line:
        from backend.api import RiotAPI
        test_api = RiotAPI(api_key, region)
        result = test_api.test_connection(summoner_name, tag_line)
        if result["success"]:
            global _poller, _api
            _db.save_setting("puuid", result["puuid"])
            if _api:
                _api.api_key = api_key
                _api.region = region
            if not _poller:
                from backend.poller import ArenaPoller
                import threading
                sync_interval = int(settings.get("sync_interval", "120"))
                _poller = ArenaPoller(test_api, _db, interval_seconds=sync_interval)
                _poller.set_puuid(result["puuid"])
                _poller.on_sync_complete(_broadcast_sync_event)
                def _bootstrap():
                    try:
                        patch = test_api.get_current_patch()
                        _db.save_setting("patch", patch)
                        _assets.download_all_assets(patch)
                    except Exception:
                        pass
                    _poller.start()
                threading.Thread(target=_bootstrap, daemon=True).start()
            else:
                _poller.api = test_api
                _poller.set_puuid(result["puuid"])
            return jsonify({"success": True, "connected": True, "puuid": result["puuid"]})
        else:
            # Settings saved but connection failed — still return 200 so frontend knows
            return jsonify({"success": True, "connected": False, "error": result.get("error")})

    return jsonify({"success": True, "connected": False})


@app.route("/api/settings/test", methods=["POST"])
def test_api_key():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data"}), 400

    from backend.api import RiotAPI
    settings = _db.get_settings()
    api_key = data.get("api_key") or settings.get("api_key", "")
    summoner_name = data.get("summoner_name", "")
    tag_line = data.get("tag_line", "")
    region = data.get("region", "na1")

    if not summoner_name or not tag_line:
        return jsonify({"success": False, "error": "Missing required fields"}), 400

    test_api = RiotAPI(api_key, region)
    result = test_api.test_connection(summoner_name, tag_line)
    return jsonify(result)


@app.route("/api/sync", methods=["POST"])
def trigger_sync():
    if not _poller:
        return jsonify({"error": "Poller not initialized"}), 503
    if _poller.status.get("syncing"):
        return jsonify({"message": "Sync already in progress"})
    import threading
    threading.Thread(target=_poller.sync, daemon=True).start()
    return jsonify({"message": "Sync started"})


@app.route("/api/events")
def sse_events():
    import queue

    def stream():
        q = queue.Queue()
        _sse_clients.append(q)
        try:
            yield "data: {\"event\": \"connected\"}\n\n"
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                except Exception:
                    yield ": keepalive\n\n"
        finally:
            if q in _sse_clients:
                _sse_clients.remove(q)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/export/csv")
def export_csv():
    import csv
    import io
    result = _db.get_games(limit=10000, offset=0)
    games = result["games"]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Date", "Champion", "Placement", "Kills", "Deaths", "Assists",
        "Damage Dealt", "Damage Taken", "Gold", "Duration (s)",
        "Duo Partner", "Patch", "Match ID",
        "Augment 1", "Augment 2", "Augment 3", "Augment 4",
    ])
    for g in games:
        augs = {a["slot"]: a["augment_name"] for a in g.get("augments", [])}
        writer.writerow([
            g["game_date"], g["champion_name"], g["placement"],
            g["kills"], g["deaths"], g["assists"],
            g["damage_dealt"], g["damage_taken"], g["gold_earned"],
            g["duration_seconds"], g.get("duo_partner", ""), g.get("patch", ""),
            g["match_id"],
            augs.get(1, ""), augs.get(2, ""), augs.get(3, ""), augs.get(4, ""),
        ])

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=arena_history.csv"},
    )


@app.route("/api/data/clear", methods=["POST"])
def clear_data():
    import sqlite3
    from backend.database import DB_PATH
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM augments")
        conn.execute("DELETE FROM items")
        conn.execute("DELETE FROM games")
        conn.commit()
    return jsonify({"success": True})
