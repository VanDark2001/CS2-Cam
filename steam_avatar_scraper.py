"""Download Steam profile avatars by SteamID64 into a local cache."""

from __future__ import annotations

import re
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AVATAR_DIR = Path(os.getenv("CS2_DATA_ROOT", str(ROOT))) / "avatars"
STEAM_ID = re.compile(r"^\d{17}$")
HEADERS = {"User-Agent": "Mozilla/5.0 (CS2 Demo Stats Avatar Cache/1.0)"}
REQUEST_TIMEOUT = max(1.0, float(os.getenv("STEAM_AVATAR_TIMEOUT_SECONDS", "5")))
MAX_WORKERS = min(8, max(1, int(os.getenv("STEAM_AVATAR_WORKERS", "4"))))


def download_avatar(steamid: str, force: bool = False) -> Path | None:
    if not STEAM_ID.fullmatch(steamid):
        return None
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    target = AVATAR_DIR / f"{steamid}.jpg"
    if target.is_file() and target.stat().st_size > 0 and not force:
        return target

    profile_url = f"https://steamcommunity.com/profiles/{steamid}?xml=1"
    try:
        request = urllib.request.Request(profile_url, headers=HEADERS)
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            root = ET.fromstring(response.read())
        avatar_url = (root.findtext("avatarFull") or "").strip()
        if not avatar_url.startswith("https://"):
            return None
        request = urllib.request.Request(avatar_url, headers=HEADERS)
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            content = response.read(2 * 1024 * 1024 + 1)
        if not content or len(content) > 2 * 1024 * 1024:
            return None
        temporary = target.with_suffix(".tmp")
        temporary.write_bytes(content)
        temporary.replace(target)
        return target
    except Exception as exc:
        print(f"[avatar] {steamid}: {exc}", file=sys.stderr)
        return None


def download_avatars(steamids: list[str]) -> tuple[int, int]:
    unique_ids = list(dict.fromkeys(map(str, steamids)))
    if not unique_ids:
        return 0, 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        results = list(executor.map(download_avatar, unique_ids))
    saved = sum(result is not None for result in results)
    failed = len(results) - saved
    return saved, failed


if __name__ == "__main__":
    ids = sys.argv[1:]
    if not ids:
        try:
            from db_schema import open_application_database
            connection = open_application_database()
            with connection.cursor() as cursor:
                cursor.execute("SELECT DISTINCT steamid FROM match_players")
                ids = [row[0] for row in cursor.fetchall()]
            connection.close()
        except Exception as exc:
            print(f"[avatar] database lookup failed: {exc}", file=sys.stderr)
    ok, failed = download_avatars(ids)
    print(f"avatars cached={ok} failed={failed} directory={AVATAR_DIR}")
