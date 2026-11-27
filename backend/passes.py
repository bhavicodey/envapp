"""Real Sentinel-2 and Sentinel-5P passes over a place, read from the Earth Engine archive.

Their images carry the time they were taken, so we can list exactly when each satellite last looked at the area.
"""
import logging
import time
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone

import ee
from fastapi import APIRouter, Depends, HTTPException, Query

from . import ee_client
from . import layers as L

log = logging.getLogger("firescout")
router = APIRouter(prefix="/api")
_cache: dict = {}
TTL = 3600


def _require_ee():
    try:
        ee_client.ensure()
    except ee_client.EENotReady as exc:
        raise HTTPException(503, str(exc)) from exc


def _iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sentinel2_passes(point, start: str, end: str):
    col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
           .filterBounds(point).filterDate(start, L.plus(end, 1)))
    info = ee.Dictionary({
        "t": col.aggregate_array("system:time_start"),
        "cloud": col.aggregate_array("CLOUDY_PIXEL_PERCENTAGE"),
        "sc": col.aggregate_array("SPACECRAFT_NAME"),
        "tile": col.aggregate_array("MGRS_TILE"),
    }).getInfo()
    # one pass (datatake) lights up several 100 km tiles a few seconds apart: group them
    groups: "OrderedDict[tuple, dict]" = OrderedDict()
    for t, c, sc, tile in sorted(zip(info["t"], info["cloud"], info["sc"], info["tile"])):
        key = (sc, t // 600000)                       # same spacecraft, same 10 minutes
        g = groups.setdefault(key, {"t": t, "spacecraft": sc, "clouds": [], "tiles": set()})
        g["clouds"].append(c)
        g["tiles"].add(tile)
    out = [{"time": _iso(g["t"]), "spacecraft": g["spacecraft"],
            "cloud_pct": round(sum(g["clouds"]) / len(g["clouds"]), 1) if g["clouds"] else None,
            "tiles": len(g["tiles"])} for g in groups.values()]
    return sorted(out, key=lambda p: p["time"], reverse=True)


def sentinel5p_passes(point, start: str, end: str):
    recent = (date.today() - date.fromisoformat(end)).days < 10
    name = "COPERNICUS/S5P/NRTI/L3_SO2" if recent else "COPERNICUS/S5P/OFFL/L3_SO2"
    col = ee.ImageCollection(name).filterBounds(point).filterDate(start, L.plus(end, 1))

    def probe(img):
        cf = img.select("cloud_fraction").reduceRegion(ee.Reducer.first(), point, 5000).get("cloud_fraction")
        return ee.Feature(None, {"t": img.get("system:time_start"), "cf": cf})

    feats = ee.FeatureCollection(col.map(probe)).filter(ee.Filter.notNull(["cf"])).getInfo()["features"]
    out = [{"time": _iso(f["properties"]["t"]),
            "cloud_pct": round(f["properties"]["cf"] * 100, 1)} for f in feats]
    return sorted(out, key=lambda p: p["time"], reverse=True)


@router.get("/passes", dependencies=[Depends(_require_ee)])
def passes(
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """When Sentinel-2 (last 30 days) and Sentinel-5P (last 5 days) passed over this point."""
    try:
        e = date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(400, "Dates must look like 2025-01-14.") from exc
    if e > date.today():
        raise HTTPException(400, "That date is in the future.")
    key = (end, round(lat, 2), round(lon, 2))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]

    point = ee.Geometry.Point([lon, lat])
    result = {"end": end, "lat": lat, "lon": lon}
    try:
        result["sentinel2"] = {"passes": sentinel2_passes(point, (e - timedelta(days=29)).isoformat(), end), "days": 30}
    except Exception as exc:  # noqa: BLE001
        log.warning("Sentinel-2 pass lookup failed: %s", exc)
        result["sentinel2"] = {"passes": None, "days": 30, "error": "Couldn't read the Sentinel-2 archive."}
    try:
        result["sentinel5p"] = {"passes": sentinel5p_passes(point, (e - timedelta(days=4)).isoformat(), end), "days": 5}
    except Exception as exc:  # noqa: BLE001
        log.warning("Sentinel-5P pass lookup failed: %s", exc)
        result["sentinel5p"] = {"passes": None, "days": 5, "error": "Couldn't read the Sentinel-5P archive."}
    _cache[key] = (time.time(), result)
    return result
