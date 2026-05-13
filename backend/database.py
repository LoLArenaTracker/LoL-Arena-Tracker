import sqlite3
import os
from contextlib import contextmanager

def _get_data_dir():
    """Return a user-writable data directory that survives updates."""
    if os.environ.get('APPDATA'):
        d = os.path.join(os.environ['APPDATA'], 'arena-tracker')
    else:
        d = os.path.join(os.path.expanduser('~'), '.arena-tracker')
    os.makedirs(d, exist_ok=True)
    return d

DB_PATH = os.path.join(_get_data_dir(), "arena_tracker.db")


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _migrate(conn):
    for col, typedef in [
        ("duo_champion_name",      "TEXT"),
        ("duo_champion_id",        "INTEGER"),
        ("magic_damage",           "INTEGER DEFAULT 0"),
        ("physical_damage",        "INTEGER DEFAULT 0"),
        ("true_damage",            "INTEGER DEFAULT 0"),
        ("total_heal",             "INTEGER DEFAULT 0"),
        ("heal_on_teammates",      "INTEGER DEFAULT 0"),
        ("magic_damage_taken",     "INTEGER DEFAULT 0"),
        ("physical_damage_taken",  "INTEGER DEFAULT 0"),
        ("true_damage_taken",      "INTEGER DEFAULT 0"),
        ("teammate2_name",         "TEXT"),
        ("teammate2_champion_name","TEXT"),
        ("teammate2_champion_id",  "INTEGER"),
        ("game_mode",              "TEXT DEFAULT 'duos'"),
    ]:
        try:
            conn.execute(f"ALTER TABLE games ADD COLUMN {col} {typedef}")
        except Exception:
            pass  # column already exists


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                match_id TEXT UNIQUE NOT NULL,
                game_date TEXT NOT NULL,
                champion_id INTEGER NOT NULL,
                champion_name TEXT NOT NULL,
                placement INTEGER NOT NULL,
                kills INTEGER DEFAULT 0,
                deaths INTEGER DEFAULT 0,
                assists INTEGER DEFAULT 0,
                damage_dealt INTEGER DEFAULT 0,
                damage_taken INTEGER DEFAULT 0,
                gold_earned INTEGER DEFAULT 0,
                duration_seconds INTEGER DEFAULT 0,
                duo_partner TEXT,
                patch TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS augments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                augment_id INTEGER NOT NULL,
                augment_name TEXT NOT NULL,
                tier TEXT NOT NULL,
                slot INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                item_id INTEGER NOT NULL,
                item_name TEXT NOT NULL,
                slot INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS asset_cache (
                asset_type TEXT NOT NULL,
                asset_id TEXT NOT NULL,
                local_path TEXT NOT NULL,
                patch TEXT NOT NULL,
                PRIMARY KEY (asset_type, asset_id)
            );
        """)
        _migrate(conn)


def _mode_clause(game_mode):
    """Return (sql_fragment, params) for optional game_mode filtering."""
    if game_mode and game_mode in ('duos', 'trios'):
        return "AND game_mode = ?", [game_mode]
    return "", []


def save_game(game_data):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM games WHERE match_id = ?", (game_data["match_id"],)
        ).fetchone()
        if existing:
            return existing["id"]

        cur = conn.execute(
            """INSERT INTO games
               (match_id, game_date, champion_id, champion_name, placement,
                kills, deaths, assists, damage_dealt, damage_taken,
                gold_earned, duration_seconds, duo_partner, patch,
                duo_champion_name, duo_champion_id,
                magic_damage, physical_damage, true_damage,
                total_heal, heal_on_teammates,
                magic_damage_taken, physical_damage_taken, true_damage_taken,
                teammate2_name, teammate2_champion_name, teammate2_champion_id,
                game_mode)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                game_data["match_id"], game_data["game_date"],
                game_data["champion_id"], game_data["champion_name"],
                game_data["placement"], game_data["kills"],
                game_data["deaths"], game_data["assists"],
                game_data["damage_dealt"], game_data["damage_taken"],
                game_data["gold_earned"], game_data["duration_seconds"],
                game_data.get("duo_partner"), game_data.get("patch"),
                game_data.get("duo_champion_name"), game_data.get("duo_champion_id"),
                game_data.get("magic_damage", 0), game_data.get("physical_damage", 0),
                game_data.get("true_damage", 0), game_data.get("total_heal", 0),
                game_data.get("heal_on_teammates", 0), game_data.get("magic_damage_taken", 0),
                game_data.get("physical_damage_taken", 0), game_data.get("true_damage_taken", 0),
                game_data.get("teammate2_name"), game_data.get("teammate2_champion_name"),
                game_data.get("teammate2_champion_id"),
                game_data.get("game_mode", "duos"),
            ),
        )
        game_id = cur.lastrowid

        for aug in game_data.get("augments", []):
            conn.execute(
                "INSERT INTO augments (game_id, augment_id, augment_name, tier, slot) VALUES (?,?,?,?,?)",
                (game_id, aug["augment_id"], aug["augment_name"], aug["tier"], aug["slot"]),
            )

        for item in game_data.get("items", []):
            conn.execute(
                "INSERT INTO items (game_id, item_id, item_name, slot) VALUES (?,?,?,?)",
                (game_id, item["item_id"], item["item_name"], item["slot"]),
            )

        return game_id


def get_games(limit=20, offset=0, filters=None, game_mode=None):
    filters = filters or {}
    where_clauses = []
    params = []

    if filters.get("champion_name"):
        where_clauses.append("g.champion_name = ?")
        params.append(filters["champion_name"])
    if filters.get("placement_min"):
        where_clauses.append("g.placement >= ?")
        params.append(filters["placement_min"])
    if filters.get("placement_max"):
        where_clauses.append("g.placement <= ?")
        params.append(filters["placement_max"])
    if filters.get("date_from"):
        where_clauses.append("g.game_date >= ?")
        params.append(filters["date_from"])
    if filters.get("date_to"):
        where_clauses.append("g.game_date <= ?")
        params.append(filters["date_to"])
    if filters.get("patch"):
        where_clauses.append("g.patch = ?")
        params.append(filters["patch"])
    if game_mode and game_mode in ('duos', 'trios'):
        where_clauses.append("g.game_mode = ?")
        params.append(game_mode)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT g.* FROM games g {where_sql}
                ORDER BY g.game_date DESC LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

        games = []
        for row in rows:
            game = dict(row)
            game["augments"] = [
                dict(a) for a in conn.execute(
                    "SELECT * FROM augments WHERE game_id = ? ORDER BY slot", (game["id"],)
                ).fetchall()
            ]
            game["items"] = [
                dict(i) for i in conn.execute(
                    "SELECT * FROM items WHERE game_id = ? ORDER BY slot", (game["id"],)
                ).fetchall()
            ]
            games.append(game)

        total = conn.execute(
            f"SELECT COUNT(*) FROM games g {where_sql}", params
        ).fetchone()[0]

        return {"games": games, "total": total}


def get_game_by_match_id(match_id):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM games WHERE match_id = ?", (match_id,)).fetchone()
        return dict(row) if row else None


def get_game_detail(game_id):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
        if not row:
            return None
        game = dict(row)
        game["augments"] = [dict(a) for a in conn.execute(
            "SELECT * FROM augments WHERE game_id = ? ORDER BY slot", (game_id,)
        ).fetchall()]
        game["items"] = [dict(i) for i in conn.execute(
            "SELECT * FROM items WHERE game_id = ? ORDER BY slot", (game_id,)
        ).fetchall()]
        return game


def get_champion_stats(game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        rows = conn.execute(f"""
            SELECT champion_name, champion_id,
                   COUNT(*) as games,
                   AVG(placement) as avg_placement,
                   MIN(placement) as best_placement,
                   SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as win_rate,
                   SUM(CASE WHEN placement <= 4 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as top4_rate
            FROM games
            WHERE 1=1 {mc}
            GROUP BY champion_name, champion_id
            ORDER BY games DESC
        """, mp).fetchall()
        return [dict(r) for r in rows]


def get_augment_stats(game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        rows = conn.execute(f"""
            SELECT a.augment_id, a.augment_name, a.tier,
                   COUNT(*) as times_taken,
                   AVG(g.placement) as avg_placement,
                   MIN(g.placement) as best_placement
            FROM augments a JOIN games g ON a.game_id = g.id
            WHERE 1=1 {mc}
            GROUP BY a.augment_id, a.augment_name, a.tier
            ORDER BY times_taken DESC
        """, mp).fetchall()
        return [dict(r) for r in rows]


def get_item_stats(game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        rows = conn.execute(f"""
            SELECT i.item_id, i.item_name,
                   COUNT(*) as times_built,
                   AVG(g.placement) as avg_placement
            FROM items i JOIN games g ON i.game_id = g.id
            WHERE 1=1 {mc}
            GROUP BY i.item_id, i.item_name
            ORDER BY times_built DESC
        """, mp).fetchall()
        return [dict(r) for r in rows]


def get_placement_trend(last_n=50, game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT placement, game_date, champion_name, match_id FROM games WHERE 1=1 {mc} ORDER BY game_date DESC LIMIT ?",
            mp + [last_n],
        ).fetchall()
        return [dict(r) for r in reversed(rows)]


def get_settings():
    with get_conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: r["value"] for r in rows}


def save_setting(key, value):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value)
        )


def get_streak(game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT placement FROM games WHERE 1=1 {mc} ORDER BY game_date DESC LIMIT 20", mp
        ).fetchall()
        if not rows:
            return {"streak": 0, "type": None}
        placements = [r["placement"] for r in rows]
        first_is_win = placements[0] == 1
        first_is_top4 = placements[0] <= 4
        streak = 0
        if first_is_win:
            for p in placements:
                if p == 1: streak += 1
                else: break
            return {"streak": streak, "type": "win"}
        elif first_is_top4:
            for p in placements:
                if p <= 4: streak += 1
                else: break
            return {"streak": streak, "type": "top4"}
        else:
            for p in placements:
                if p > 4: streak += 1
                else: break
            return {"streak": streak, "type": "loss"}


def get_best_champion(game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        row = conn.execute(f"""
            SELECT champion_name, champion_id,
                   COUNT(*) as games,
                   AVG(placement) as avg_placement,
                   SUM(CASE WHEN placement=1 THEN 1 ELSE 0 END)*100.0/COUNT(*) as win_rate,
                   SUM(CASE WHEN placement<=4 THEN 1 ELSE 0 END)*100.0/COUNT(*) as top4_rate
            FROM games
            WHERE 1=1 {mc}
            GROUP BY champion_name, champion_id
            HAVING COUNT(*) >= 2
            ORDER BY avg_placement ASC
            LIMIT 1
        """, mp).fetchone()
        return dict(row) if row else None


def get_top_damage_games(game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        rows = conn.execute(f"""
            SELECT g.* FROM games g
            INNER JOIN (
                SELECT champion_name, MAX(damage_dealt) as max_dmg
                FROM games WHERE 1=1 {mc} GROUP BY champion_name
            ) best ON g.champion_name = best.champion_name
                     AND g.damage_dealt = best.max_dmg
            WHERE 1=1 {mc}
            ORDER BY g.damage_dealt DESC
        """, mp + mp).fetchall()
        games = []
        for row in rows:
            game = dict(row)
            game["augments"] = [dict(a) for a in conn.execute(
                "SELECT * FROM augments WHERE game_id = ? ORDER BY slot", (game["id"],)
            ).fetchall()]
            game["items"] = [dict(i) for i in conn.execute(
                "SELECT * FROM items WHERE game_id = ? ORDER BY slot", (game["id"],)
            ).fetchall()]
            games.append(game)
        return games


def get_wins_collection(game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        overall_max = conn.execute(f"SELECT MAX(damage_dealt) FROM games WHERE 1=1 {mc}", mp).fetchone()[0] or 0
        rows = conn.execute(f"""
            SELECT
                g.champion_name, g.champion_id,
                COUNT(*) as win_count,
                MIN(g.game_date) as first_win,
                MAX(g.game_date) as last_win,
                (SELECT COUNT(*) FROM games g2 WHERE g2.champion_name = g.champion_name {mc}) as total_games,
                (SELECT MAX(g3.damage_dealt) FROM games g3 WHERE g3.champion_name = g.champion_name {mc}) as max_damage
            FROM games g
            WHERE g.placement = 1 {mc}
            GROUP BY g.champion_name, g.champion_id
            ORDER BY first_win ASC
        """, mp + mp + mp + mp).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["win_rate_pct"] = round(d["win_count"] * 100.0 / d["total_games"], 1) if d["total_games"] else 0
            d["overall_max_damage"] = overall_max
            result.append(d)
        return result


def get_champion_games(champion_name, limit=500, game_mode=None):
    mc, mp = _mode_clause(game_mode)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT g.* FROM games g WHERE g.champion_name = ? {mc}
               ORDER BY g.game_date DESC LIMIT ?""",
            [champion_name] + mp + [limit]
        ).fetchall()
        games = []
        for row in rows:
            game = dict(row)
            game["augments"] = [dict(a) for a in conn.execute(
                "SELECT * FROM augments WHERE game_id = ? ORDER BY slot", (game["id"],)
            ).fetchall()]
            game["items"] = [dict(i) for i in conn.execute(
                "SELECT * FROM items WHERE game_id = ? ORDER BY slot", (game["id"],)
            ).fetchall()]
            games.append(game)
        return games


def get_summary_stats(game_mode=None):
    mc, mp = _mode_clause(game_mode)
    top_half = 3 if game_mode == 'trios' else 4
    with get_conn() as conn:
        row = conn.execute(f"""
            SELECT
                COUNT(*) as total_games,
                AVG(placement) as avg_placement,
                SUM(CASE WHEN placement <= 4 THEN 1 ELSE 0 END) * 100.0 / MAX(COUNT(*), 1) as top4_rate,
                SUM(CASE WHEN placement <= {top_half} THEN 1 ELSE 0 END) * 100.0 / MAX(COUNT(*), 1) as top_half_rate,
                SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END) * 100.0 / MAX(COUNT(*), 1) as win_rate
            FROM games
            WHERE 1=1 {mc}
        """, mp).fetchone()
        result = dict(row) if row else {}
        result['top_half_threshold'] = top_half
        return result
