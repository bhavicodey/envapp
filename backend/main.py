"""FireScout API + static frontend.  Run:  python run.py"""
import calendar as cal
import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Optional

import ee
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import config, ee_client
from . import layers as L
from . import reported as R
from . import saved as S
from . import passes as P
from . import health as H

log = logging.getLogger("firescout")
app = FastAPI(title="FireScout")

_cache: dict = {}

def cached(key, fn, ttl=config.CACHE_SECONDS):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value

_DISK_FILE = config.ROOT / ".cache" / "firescout_cache.json"
_disk_lock = threading.Lock()
_disk_timer = None
try:
    _disk = json.loads(_DISK_FILE.read_text(encoding="utf-8"))
except (OSError, ValueError):
    _disk = {}

def _disk_flush():
    global _disk_timer
    with _disk_lock:
        _disk_timer = None
        data = json.dumps(_disk, separators=(",", ":"))
    try:
        _DISK_FILE.parent.mkdir(exist_ok=True)
        tmp = _DISK_FILE.with_suffix(".tmp")
        tmp.write_text(data, encoding="utf-8")
        os.replace(tmp, _DISK_FILE)
    except OSError as exc:
        log.warning("could not save the cache: %s", exc)

def disk_cached(key: str, fn):
    """Like cached(), but kept on disk across restarts. Only use for data that can't change any more."""
    global _disk_timer
    with _disk_lock:
        if key in _disk:
            return _disk[key]
    value = fn()
    with _disk_lock:
        _disk[key] = value
        if _disk_timer is None:
            _disk_timer = threading.Timer(2.0, _disk_flush)
            _disk_timer.daemon = True
            _disk_timer.start()
    return value

def finished(last_day: date) -> bool:
    """True once a period is safely in the past (near-real-time fire data can still arrive for ~a week)."""
    return last_day < date.today() - timedelta(days=8)

def require_ee():
    try:
        ee_client.ensure()
    except ee_client.EENotReady as exc:
        raise HTTPException(503, str(exc)) from exc

def check_dates(start: str, end: str, max_days: int = 40):
    try:
        s, e = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(400, "Dates must look like 2025-01-14.") from exc
    if e < s or (e - s).days > max_days:
        raise HTTPException(400, f"Date window must be between 1 and {max_days} days.")
    if e > date.today():
        raise HTTPException(400, "That date is in the future.")

def safe(fn):
    """Run an Earth Engine call; return None instead of failing the whole request."""
    try:
        return fn()
    except Exception as exc:
        log.warning("Earth Engine call failed: %s", exc)
        return None

def parse_geom(geom: Optional[str]):
    """`geom` is a JSON list of [lon, lat] points (a polygon drawn on the map)."""
    if not geom:
        return None
    try:
        pts = json.loads(geom)
        pts = [[float(p[0]), float(p[1])] for p in pts]
    except (ValueError, TypeError, IndexError) as exc:
        raise HTTPException(400, "The drawn area could not be read.") from exc
    if not 3 <= len(pts) <= 300 or any(not (-180 <= x <= 180 and -90 <= y <= 90) for x, y in pts):
        raise HTTPException(400, "The drawn area needs 3 to 300 points on the globe.")
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts

def region_of(lat, lon, radius_km, pts, cap_km=None):
    if pts:
        return ee.Geometry.Polygon([pts], None, False)
    return ee.Geometry.Point([lon, lat]).buffer((min(radius_km, cap_km) if cap_km else radius_km) * 1000)

def area_key(lat, lon, radius_km, pts):
    if pts:
        return "poly:" + hashlib.sha1(json.dumps(pts).encode()).hexdigest()[:16]
    return f"circle:{round(lat, 3)}:{round(lon, 3)}:{radius_km}"

GEOM = Query(None, max_length=20000, description="JSON list of [lon, lat] points for a drawn area")

@app.get("/api/health")
def health():
    try:
        ee_client.ensure()
        return {"ok": True, "project": config.EE_PROJECT}
    except ee_client.EENotReady as exc:
        return {"ok": False, "error": str(exc)}

@app.get("/api/meta")
def meta():
    return L.META

@app.get("/api/tiles/{layer}", dependencies=[Depends(require_ee)])
def tiles(
    layer: str,
    start: str,
    end: str,
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    geom: Optional[str] = GEOM,
):
    if layer not in L.VIS:
        raise HTTPException(404, "Unknown layer.")
    check_dates(start, end)
    pts = parse_geom(geom)
    if layer == "burn" and not pts and (lat is None or lon is None):
        raise HTTPException(400, "Click the globe to choose an area for burn scars.")

    key = ("tiles", layer, start, end, area_key(lat, lon, radius_km, pts) if layer == "burn" else None)

    def build():
        if layer == "so2":
            if L.so2_collection(start, end).size().getInfo() == 0:
                raise HTTPException(404, "No sulfur dioxide data for this window yet. Try an earlier date.")
            img = L.so2_tile_image(start, end)
        elif layer == "smoke":
            if L.aer_collection(start, end).size().getInfo() == 0:
                raise HTTPException(404, "No smoke data for this window yet. Try an earlier date.")
            img = L.aer_tile_image(start, end)
        elif layer == "fire":
            if L.fire_collection(start, end).size().getInfo() == 0:
                raise HTTPException(404, "No fire data for this window yet. Try an earlier date.")
            img = L.fire_tile_image(start, end)
        else:
            region = region_of(lat, lon, radius_km, pts)
            (_, _), (post_a, post_b) = L.burn_windows(end)
            if L.s2_collection(region, post_a, post_b).size().getInfo() == 0:
                raise HTTPException(404, "No clear Sentinel-2 images in the 30 days before this date.")
            img = L.burn_tile_image(region, end)
        try:
            return img.getMapId(L.VIS[layer])["tile_fetcher"].url_format
        except ee.EEException as exc:
            raise HTTPException(502, f"Earth Engine error: {exc}") from exc

    return {"url": cached(key, build)}

def _calendar(region, akey, year, month):
    """Daily fire-hotspot counts for one month. Finished months are kept on disk."""
    last = date(year, month, cal.monthrange(year, month)[1])
    build = lambda: L.fire_calendar(region, year, month)
    if finished(last):
        return disk_cached(f"cal|firms|{year}-{month:02d}|{akey}", build)
    return cached(("fire_calendar", year, month, akey), build)

@app.get("/api/fire_calendar", dependencies=[Depends(require_ee)])
def fire_calendar(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    geom: Optional[str] = GEOM,
):
    first = date.fromisoformat(L.FIRE_FIRST)
    if date(year, month, cal.monthrange(year, month)[1]) < first:
        raise HTTPException(400, f"Fire records start {first.isoformat()}.")
    if date(year, month, 1) > date.today():
        raise HTTPException(400, "This month is in the future.")
    pts = parse_geom(geom)
    days = _calendar(region_of(lat, lon, radius_km, pts), area_key(lat, lon, radius_km, pts), year, month)
    return {"year": year, "month": month, "days": days}

@app.get("/api/insights", dependencies=[Depends(require_ee)])
def insights(
    start: str,
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    geom: Optional[str] = GEOM,
    include_burn: bool = Query(True, description="false = skip burned area (fetch it from /api/burned instead)"),
):
    check_dates(start, end)
    pts = parse_geom(geom)

    def build():
        region = region_of(lat, lon, radius_km, pts)
        burn_region = region_of(lat, lon, radius_km, pts, cap_km=150)
        base_start, base_end = L.plus(start, -30), L.plus(start, -1)
        jobs = {
            "so2": lambda: L.so2_mean_du(region, start, end),
            "base": lambda: L.so2_mean_du(region, base_start, base_end),
            "fire": lambda: L.fire_pixel_count(region, start, end),
            "fires": lambda: L.fire_clusters(region, start, end),
            "aer": lambda: L.aer_stats(region, start, end),
        }
        if include_burn:
            jobs["burn"] = lambda: L.burned_hectares(burn_region, end, min(radius_km, 150))
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = {k: pool.submit(safe, fn) for k, fn in jobs.items()}
            r = {k: f.result() for k, f in futures.items()}

        ratio = r["so2"] / r["base"] if r["so2"] is not None and r["base"] and r["base"] > 0 else None
        level, reason = classify(r["fire"], ratio)
        aer = r.get("aer") or {}
        card = H.card(r["fire"], aer.get("p90"), ratio, aer.get("mean"))
        return {
            "fire_pixels": r["fire"],
            "fire_count": (r.get("fires") or {}).get("count"), "largest_fire_px": (r.get("fires") or {}).get("largest_px"),
            "fire_sizes": (r.get("fires") or {}).get("sizes"),
            "so2_du": r["so2"], "so2_baseline_du": r["base"],
            "so2_ratio": ratio, "burned_ha": r.get("burn"),
            "signal": level, "signal_reason": reason,
            "smoke_index": aer.get("p90"), "smoke_index_mean": aer.get("mean"), "health": card,
        }

    return cached(("ins3", start, end, area_key(lat, lon, radius_km, pts), include_burn), build)

@app.get("/api/reported")
def reported(
    start: str,
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    geom: Optional[str] = GEOM,
):
    """Wildfires reported by US fire agencies (NIFC), to set beside what the satellites detected."""
    check_dates(start, end, max_days=366)
    pts = parse_geom(geom)

    def build():
        try:
            return R.reported_fires(start, end, lat, lon, radius_km, pts)
        except Exception as exc:
            log.warning("NIFC query failed: %s", exc)
            raise HTTPException(502, "The US fire incident database didn't answer. Try again in a moment.") from exc

    return cached(("reported", start, end, area_key(lat, lon, radius_km, pts)), build)

@app.get("/api/burned", dependencies=[Depends(require_ee)])
def burned(
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    geom: Optional[str] = GEOM,
):
    """Burned hectares on its own, so the faster fire and SO2 numbers don't have to wait for it."""
    check_dates(L.plus(end, -1), end)
    pts = parse_geom(geom)

    def build():
        return {"burned_ha": safe(lambda: L.burned_hectares(region_of(lat, lon, radius_km, pts, cap_km=150), end, min(radius_km, 150)))}

    return cached(("burn", end, area_key(lat, lon, radius_km, pts)), build)

def classify(fire, ratio):
    fire = fire or 0
    if fire >= config.ALERT_MIN_FIRE_PIXELS and ratio and ratio >= config.ALERT_SO2_RATIO:
        return "alert", f"Last 7 days: {fire} fire hotspots and sulfur dioxide at {ratio:.1f} times the usual level."
    if fire >= config.WATCH_FIRE_PIXELS:
        return "watch", f"Last 7 days: {fire} fire hotspots in this area."
    if ratio and ratio >= config.WATCH_SO2_RATIO:
        return "watch", f"Last 7 days: sulfur dioxide at {ratio:.1f} times the usual level."
    return "none", "Nothing unusual in the last 7 days."

@app.get("/api/hotspots", dependencies=[Depends(require_ee)])
def hotspots(
    start: str,
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    confidence: str = Query("all", pattern="^(all|nominal|high)$"),
    geom: Optional[str] = GEOM,
    limit: int = Query(50000, ge=1, le=50000),
):
    """Fire hotspot records (one row per hotspot per day) for any range up to a year.
    Fetched in month-sized chunks (Earth Engine returns at most 5,000 rows per request)."""
    check_dates(start, end, max_days=366)
    pts = parse_geom(geom)
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    chunks, a = [], s
    while a <= e:
        b = min(e, a + timedelta(days=30))
        chunks.append((a, b))
        a = b + timedelta(days=1)

    def build():
        region = region_of(lat, lon, radius_km, pts)
        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                parts = list(pool.map(lambda c: L.hotspot_records(region, c[0].isoformat(), c[1].isoformat(), confidence, 5000), chunks))
        except ee.EEException as exc:
            raise HTTPException(502, f"Earth Engine error: {exc}") from exc
        rows = [r for p in parts for r in p]
        truncated = any(len(p) >= 5000 for p in parts) or len(rows) > limit
        return {"start": start, "end": end, "confidence": confidence, "truncated": truncated, "records": rows[:limit]}

    return cached(("hotspots", start, end, area_key(lat, lon, radius_km, pts), confidence, limit), build)

@app.get("/api/monthly_summary", dependencies=[Depends(require_ee)])
def monthly_summary(
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    months: int = Query(12, ge=1, le=24),
    geom: Optional[str] = GEOM,
):
    """One summary row per month of fire hotspots, for the months up to `end`."""
    try:
        e = date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(400, "Dates must look like 2025-01-14.") from exc
    if e > date.today():
        raise HTTPException(400, "That date is in the future.")
    pts = parse_geom(geom)
    akey = area_key(lat, lon, radius_km, pts)
    ym = []
    y, m = e.year, e.month
    for _ in range(months):
        ym.append((y, m))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    ym.reverse()

    def one(y, m):
        res = safe(lambda: _calendar(region_of(lat, lon, radius_km, pts), akey, y, m))
        row = L.summarize_month(res or [], y, m)
        row["note"] = "" if res is not None else "earth engine request failed"
        return row

    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(lambda j: one(*j), ym))
    area = "drawn polygon" if pts else f"{round(lat, 4)}, {round(lon, 4)} ± {radius_km} km"
    for r in rows:
        r["area"] = area
    return {"months": [f"{y}-{m:02d}" for y, m in ym], "rows": rows}

@app.get("/api/so2_series", dependencies=[Depends(require_ee)])
def so2_series(
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    days: int = Query(30, ge=7, le=60),
    geom: Optional[str] = GEOM,
):
    check_dates(L.plus(end, -6), end)
    pts = parse_geom(geom)

    def build():
        region = region_of(lat, lon, radius_km, pts)
        try:
            return L.so2_daily_du(region, end, days)
        except ee.EEException as exc:
            raise HTTPException(502, f"Earth Engine error: {exc}") from exc

    return cached(("series", end, area_key(lat, lon, radius_km, pts), days), build)

app.include_router(S.router)
app.include_router(P.router)


@app.middleware("http")
async def cache_headers(request, call_next):
    resp = await call_next(request)
    path = request.url.path
    if not path.startswith("/api/"):
        resp.headers["Cache-Control"] = "public, max-age=86400" if path.startswith("/media/") else "no-cache"
    return resp

app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")

