import os
import sys
import time
import requests
import logging

logger = logging.getLogger(__name__)


def _get_cert_path():
    """Return the SSL cert bundle path, handling PyInstaller frozen bundles."""
    try:
        import certifi
        cert = certifi.where()
        if os.path.exists(cert):
            return cert
    except Exception:
        pass
    if getattr(sys, 'frozen', False):
        # Fallback: manually find cert in _MEIPASS
        cert = os.path.join(sys._MEIPASS, 'certifi', 'cacert.pem')
        if os.path.exists(cert):
            return cert
    return True

BASE_URLS = {
    "na1": "https://na1.api.riotgames.com",
    "euw1": "https://euw1.api.riotgames.com",
    "eun1": "https://eun1.api.riotgames.com",
    "kr": "https://kr.api.riotgames.com",
    "br1": "https://br1.api.riotgames.com",
    "la1": "https://la1.api.riotgames.com",
    "la2": "https://la2.api.riotgames.com",
    "oc1": "https://oc1.api.riotgames.com",
    "tr1": "https://tr1.api.riotgames.com",
    "ru": "https://ru.api.riotgames.com",
}

REGIONAL_URLS = {
    "na1": "https://americas.api.riotgames.com",
    "br1": "https://americas.api.riotgames.com",
    "la1": "https://americas.api.riotgames.com",
    "la2": "https://americas.api.riotgames.com",
    "oc1": "https://americas.api.riotgames.com",
    "euw1": "https://europe.api.riotgames.com",
    "eun1": "https://europe.api.riotgames.com",
    "tr1": "https://europe.api.riotgames.com",
    "ru": "https://europe.api.riotgames.com",
    "kr": "https://asia.api.riotgames.com",
    "jp1": "https://asia.api.riotgames.com",
}

ARENA_QUEUE_IDS = [1700, 1710]  # 1700 = original 2v2, 1710 = 3v3 (patch 26.10+)


class RiotAPIError(Exception):
    def __init__(self, status_code, message):
        self.status_code = status_code
        super().__init__(message)


class RiotAPI:
    def __init__(self, api_key, region="na1"):
        self.api_key = api_key
        self.region = region
        self._last_request_time = 0
        self._min_interval = 0.055  # ~18 req/s to stay under 20 req/s limit
        self._verify = _get_cert_path()

    def _headers(self):
        return {"X-Riot-Token": self.api_key}

    def _get(self, url, params=None, retries=3):
        for attempt in range(retries):
            elapsed = time.time() - self._last_request_time
            if elapsed < self._min_interval:
                time.sleep(self._min_interval - elapsed)

            self._last_request_time = time.time()
            try:
                resp = requests.get(url, headers=self._headers(), params=params, timeout=10, verify=self._verify)
            except requests.RequestException as e:
                logger.warning(f"Request error: {e}")
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise

            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 5))
                logger.warning(f"Rate limited. Waiting {retry_after}s")
                time.sleep(retry_after + 1)
                continue
            elif resp.status_code == 401:
                raise RiotAPIError(401, "Invalid or expired API key. Please update your key in Settings.")
            elif resp.status_code == 403:
                raise RiotAPIError(403, "API key does not have access to this endpoint.")
            elif resp.status_code == 404:
                raise RiotAPIError(404, "Resource not found.")
            elif resp.status_code >= 500:
                logger.warning(f"Riot server error {resp.status_code}, attempt {attempt+1}")
                if attempt < retries - 1:
                    time.sleep(3)
                    continue
                raise RiotAPIError(resp.status_code, "Riot API server error.")
            else:
                raise RiotAPIError(resp.status_code, f"Unexpected status: {resp.status_code}")

        raise RiotAPIError(0, "Max retries exceeded")

    def _regional_url(self):
        return REGIONAL_URLS.get(self.region, "https://americas.api.riotgames.com")

    def _platform_url(self):
        return BASE_URLS.get(self.region, "https://na1.api.riotgames.com")

    def get_account_by_riot_id(self, game_name, tag_line):
        url = f"{self._regional_url()}/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}"
        return self._get(url)

    def get_summoner_by_puuid(self, puuid):
        url = f"{self._platform_url()}/lol/summoner/v4/summoners/by-puuid/{puuid}"
        return self._get(url)

    def get_arena_match_ids(self, puuid, start=0, count=20):
        url = f"{self._regional_url()}/lol/match/v5/matches/by-puuid/{puuid}/ids"
        all_ids = []
        seen = set()
        for queue_id in ARENA_QUEUE_IDS:
            ids = self._get(url, params={"queue": queue_id, "start": start, "count": count})
            for mid in ids:
                if mid not in seen:
                    seen.add(mid)
                    all_ids.append(mid)
        return all_ids

    def get_match(self, match_id):
        url = f"{self._regional_url()}/lol/match/v5/matches/{match_id}"
        return self._get(url)

    def get_current_patch(self):
        resp = requests.get("https://ddragon.leagueoflegends.com/api/versions.json", timeout=10, verify=self._verify)
        resp.raise_for_status()
        versions = resp.json()
        return versions[0] if versions else "15.8.1"

    def test_connection(self, game_name, tag_line):
        try:
            account = self.get_account_by_riot_id(game_name, tag_line)
            return {"success": True, "puuid": account.get("puuid"), "account": account}
        except RiotAPIError as e:
            return {"success": False, "error": str(e), "status_code": e.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}
