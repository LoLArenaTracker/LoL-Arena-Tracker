import os
import json
import requests
import logging

logger = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(ROOT, "assets")
CHAMPIONS_DIR = os.path.join(ASSETS_DIR, "champions")
ITEMS_DIR = os.path.join(ASSETS_DIR, "items")
AUGMENTS_DIR = os.path.join(ASSETS_DIR, "augments")

DDRAGON_BASE = "https://ddragon.leagueoflegends.com"
CDRAGON_BASE = "https://raw.communitydragon.org/latest"

PLACEHOLDER_PATH = os.path.join(ASSETS_DIR, "placeholder.png")


def ensure_dirs():
    for d in [CHAMPIONS_DIR, ITEMS_DIR, AUGMENTS_DIR]:
        os.makedirs(d, exist_ok=True)


def _download_file(url, dest_path, timeout=15):
    if os.path.exists(dest_path):
        return True
    try:
        resp = requests.get(url, timeout=timeout)
        if resp.status_code == 200:
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            with open(dest_path, "wb") as f:
                f.write(resp.content)
            return True
        logger.warning(f"Failed to download {url}: {resp.status_code}")
        return False
    except Exception as e:
        logger.warning(f"Error downloading {url}: {e}")
        return False


def _download_json(url, dest_path=None, timeout=15):
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        if dest_path:
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            with open(dest_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
        return data
    except Exception as e:
        logger.warning(f"Error fetching JSON from {url}: {e}")
        return None


def download_champion_icons(patch):
    ensure_dirs()
    champ_url = f"{DDRAGON_BASE}/cdn/{patch}/data/en_US/champion.json"
    data_path = os.path.join(ASSETS_DIR, "champion_data.json")
    champ_data = _download_json(champ_url, data_path)
    if not champ_data:
        return

    champions = champ_data.get("data", {})
    downloaded = 0
    for name, info in champions.items():
        champ_id = info.get("key")
        dest = os.path.join(CHAMPIONS_DIR, f"{champ_id}.png")
        if not os.path.exists(dest):
            icon_url = f"{DDRAGON_BASE}/cdn/{patch}/img/champion/{name}.png"
            if _download_file(icon_url, dest):
                downloaded += 1

    logger.info(f"Champion icons: {downloaded} downloaded, {len(champions)} total")


def download_item_icons(patch):
    ensure_dirs()
    item_url = f"{DDRAGON_BASE}/cdn/{patch}/data/en_US/item.json"
    data_path = os.path.join(ASSETS_DIR, "item_data.json")
    item_data = _download_json(item_url, data_path)
    if not item_data:
        return

    items = item_data.get("data", {})
    downloaded = 0
    for item_id in items:
        dest = os.path.join(ITEMS_DIR, f"{item_id}.png")
        if not os.path.exists(dest):
            icon_url = f"{DDRAGON_BASE}/cdn/{patch}/img/item/{item_id}.png"
            if _download_file(icon_url, dest):
                downloaded += 1

    logger.info(f"Item icons: {downloaded} downloaded, {len(items)} total")




def refresh_augment_data():
    """Re-download augments JSON from CommunityDragon to pick up new augments."""
    aug_url = f"{CDRAGON_BASE}/cdragon/arena/en_us.json"
    data_path = os.path.join(ASSETS_DIR, "augments_data.json")
    logger.info("Refreshing augment data from CommunityDragon...")
    data = _download_json(aug_url, data_path)
    if data:
        augments = data if isinstance(data, list) else data.get("augments", [])
        downloaded = 0
        for aug in augments:
            aug_id = aug.get("id") or aug.get("apiName")
            icon_path_raw = (aug.get("iconLarge") or aug.get("iconLargeAssetPath")
                             or aug.get("iconSmall") or aug.get("iconSmallAssetPath") or "")
            if not aug_id or not icon_path_raw:
                continue
            dest = os.path.join(AUGMENTS_DIR, f"{aug_id}.png")
            if not os.path.exists(dest):
                icon_rel = icon_path_raw.lower().lstrip("/")
                icon_url = f"{CDRAGON_BASE}/game/{icon_rel}"
                if _download_file(icon_url, dest):
                    downloaded += 1
        logger.info(f"Augment refresh complete: {downloaded} new icons downloaded")


def download_all_assets(patch):
    logger.info(f"Starting asset download for patch {patch}")
    download_champion_icons(patch)
    download_item_icons(patch)
    refresh_augment_data()
    logger.info("Asset download complete")


def get_icon_path(asset_type, asset_id):
    if asset_type == "champion":
        path = os.path.join(CHAMPIONS_DIR, f"{asset_id}.png")
    elif asset_type == "item":
        path = os.path.join(ITEMS_DIR, f"{asset_id}.png")
    elif asset_type == "augment":
        path = os.path.join(AUGMENTS_DIR, f"{asset_id}.png")
    else:
        return None

    if os.path.exists(path):
        return path

    # Try to find by name match for champions
    if asset_type == "champion":
        data_path = os.path.join(ASSETS_DIR, "champion_data.json")
        if os.path.exists(data_path):
            with open(data_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for name, info in data.get("data", {}).items():
                if str(info.get("key")) == str(asset_id):
                    named_path = os.path.join(CHAMPIONS_DIR, f"{asset_id}.png")
                    if os.path.exists(named_path):
                        return named_path

    return None
