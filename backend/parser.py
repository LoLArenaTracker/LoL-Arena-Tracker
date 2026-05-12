import json
import os
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

CDRAGON_AUGMENTS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "assets", "augments_data.json"
)

_augment_map = None


def load_augment_map():
    global _augment_map
    if _augment_map is not None:
        return _augment_map
    if os.path.exists(CDRAGON_AUGMENTS_PATH):
        with open(CDRAGON_AUGMENTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        _augment_map = {}
        augments = data if isinstance(data, list) else data.get("augments", [])
        for aug in augments:
            aug_id = aug.get("id") or aug.get("apiName")
            if aug_id:
                _augment_map[int(aug_id) if str(aug_id).isdigit() else aug_id] = aug
    else:
        _augment_map = {}
    return _augment_map


def get_augment_tier(augment_data):
    if not augment_data:
        return "silver"
    rarity = augment_data.get("rarity", 0)
    name_tag = (augment_data.get("nameTags") or [])
    if isinstance(name_tag, str):
        name_tag = [name_tag]
    combined = str(rarity) + " ".join(name_tag).lower()
    if rarity == 3 or "prismatic" in combined:
        return "prismatic"
    elif rarity == 2 or "gold" in combined:
        return "gold"
    return "silver"


def get_duo_partner(match_json, puuid):
    participants = match_json["info"]["participants"]
    me = next((p for p in participants if p["puuid"] == puuid), None)
    if not me:
        return None, None, None
    my_team = me.get("playerSubteamId") or me.get("teamId")
    for p in participants:
        if p["puuid"] == puuid:
            continue
        partner_team = p.get("playerSubteamId") or p.get("teamId")
        if partner_team == my_team:
            name = p.get("summonerName") or p.get("riotIdGameName", "")
            return name, p.get("championName", ""), p.get("championId", 0)
    return None, None, None


def parse_augments(participant):
    aug_map = load_augment_map()
    augments = []
    for slot in range(1, 5):
        aug_id = participant.get(f"playerAugment{slot}", 0)
        if not aug_id:
            continue
        aug_data = aug_map.get(aug_id) or aug_map.get(str(aug_id))
        name = aug_data.get("name", f"Augment {aug_id}") if aug_data else f"Augment {aug_id}"
        tier = get_augment_tier(aug_data)
        augments.append({
            "augment_id": aug_id,
            "augment_name": name,
            "tier": tier,
            "slot": slot,
        })
    return augments


def parse_items(participant):
    items = []
    item_data = _get_item_data()
    for slot in range(7):
        item_id = participant.get(f"item{slot}", 0)
        if not item_id:
            continue
        name = item_data.get(str(item_id), {}).get("name", f"Item {item_id}") if item_data else f"Item {item_id}"
        items.append({
            "item_id": item_id,
            "item_name": name,
            "slot": slot,
        })
    return items


_item_data_cache = None

ITEM_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "assets", "item_data.json"
)


def _get_item_data():
    global _item_data_cache
    if _item_data_cache is not None:
        return _item_data_cache
    if os.path.exists(ITEM_DATA_PATH):
        with open(ITEM_DATA_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        _item_data_cache = raw.get("data", {})
    else:
        _item_data_cache = {}
    return _item_data_cache


def parse_arena_match(match_json, puuid):
    participants = match_json["info"]["participants"]
    participant = next((p for p in participants if p["puuid"] == puuid), None)
    if not participant:
        raise ValueError(f"PUUID {puuid} not found in match {match_json['metadata']['matchId']}")

    game_version = match_json["info"].get("gameVersion", "")
    parts = game_version.split(".")
    patch = f"{parts[0]}.{parts[1]}" if len(parts) >= 2 else game_version

    timestamp = match_json["info"].get("gameStartTimestamp", 0)
    game_date = datetime.fromtimestamp(timestamp / 1000).isoformat() if timestamp else datetime.now().isoformat()

    duo_name, duo_champ_name, duo_champ_id = get_duo_partner(match_json, puuid)

    return {
        "match_id": match_json["metadata"]["matchId"],
        "game_date": game_date,
        "champion_id": participant["championId"],
        "champion_name": participant["championName"],
        "placement": participant.get("placement", 8),
        "kills": participant.get("kills", 0),
        "deaths": participant.get("deaths", 0),
        "assists": participant.get("assists", 0),
        "damage_dealt": participant.get("totalDamageDealtToChampions", 0),
        "magic_damage": participant.get("magicDamageDealtToChampions", 0),
        "physical_damage": participant.get("physicalDamageDealtToChampions", 0),
        "true_damage": participant.get("trueDamageDealtToChampions", 0),
        "damage_taken": participant.get("totalDamageTaken", 0),
        "magic_damage_taken": participant.get("magicDamageTaken", 0),
        "physical_damage_taken": participant.get("physicalDamageTaken", 0),
        "true_damage_taken": participant.get("trueDamageTaken", 0),
        "total_heal": participant.get("totalHeal", 0),
        "heal_on_teammates": participant.get("totalHealsOnTeammates", 0),
        "gold_earned": participant.get("goldEarned", 0),
        "duration_seconds": match_json["info"].get("gameDuration", 0),
        "duo_partner": duo_name,
        "duo_champion_name": duo_champ_name,
        "duo_champion_id": duo_champ_id,
        "patch": patch,
        "augments": parse_augments(participant),
        "items": parse_items(participant),
    }
