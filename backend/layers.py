"""Earth Engine layer builders.

Everything here returns lazy ee objects; nothing is computed until .getInfo() or getMapId().
Date windows are inclusive of both start and end (ISO strings, YYYY-MM-DD).
"""
from datetime import date, timedelta

import ee

DU = 4.4615e-4
SO2_BAND = "SO2_column_number_density"
SO2_MIN, SO2_MAX = 0.0001, 0.0008

VIS = {
    "so2": {"min": SO2_MIN, "max": SO2_MAX,
            "palette": ["#c9f2ea", "#7fd8c8", "#2bb3a3", "#14808a", "#0d4f63"]},
    "fire": {"min": 300, "max": 500,
             "palette": ["#ffc233", "#ff7a1a", "#ff2e63", "#a3003a"]},
    "burn": {"min": 0.1, "max": 1.0,
             "palette": ["#ffe08a", "#ff9a3c", "#e5383b", "#7a0019"]},
    "smoke": {"min": 0.5, "max": 3.0,
              "palette": ["#e8e1d6", "#c8b79e", "#a08463", "#6f5640", "#3f2f24"]},
}

META = {
    "so2": {"title": "Sulfur dioxide", "palette": VIS["so2"]["palette"],
            "legend_min": f"{SO2_MIN / DU:.1f} DU", "legend_max": f"{SO2_MAX / DU:.1f} DU"},
    "fire": {"title": "Active fires", "palette": VIS["fire"]["palette"],
             "legend_min": "300 K", "legend_max": "500 K"},
    "burn": {"title": "Burn scars", "palette": VIS["burn"]["palette"],
             "legend_min": "Low severity", "legend_max": "High severity"},
    "smoke": {"title": "Smoke (aerosol index)", "palette": VIS["smoke"]["palette"],
              "legend_min": "Light", "legend_max": "Thick"},
}

def _d(s: str) -> date:
    return date.fromisoformat(s)

def plus(s: str, days: int) -> str:
    return (_d(s) + timedelta(days=days)).isoformat()

def _empty(band: str) -> ee.Image:
    return ee.Image.constant(0).rename(band).selfMask()

def so2_collection(start: str, end: str) -> ee.ImageCollection:
    recent = (date.today() - _d(end)).days < 10
    name = "COPERNICUS/S5P/NRTI/L3_SO2" if recent else "COPERNICUS/S5P/OFFL/L3_SO2"
    return (ee.ImageCollection(name)
            .filterDate(start, plus(end, 1))
            .map(lambda i: i.updateMask(i.select("cloud_fraction").lt(0.3)))
            .select(SO2_BAND))

def so2_image(start: str, end: str) -> ee.Image:
    col = so2_collection(start, end)
    return ee.Image(ee.Algorithms.If(col.size().gt(0), col.median(), _empty(SO2_BAND)))

def so2_tile_image(start: str, end: str) -> ee.Image:
    img = so2_image(start, end)
    return img.updateMask(img.gte(SO2_MIN))

def so2_mean_du(region, start: str, end: str):
    v = so2_image(start, end).reduceRegion(ee.Reducer.mean(), region, 5000, maxPixels=1e9).get(SO2_BAND)
    v = v.getInfo()
    return None if v is None else v / DU

def so2_daily_du(region, end: str, days: int = 30):
    start = plus(end, -(days - 1))
    col = so2_collection(start, end)
    start_d = ee.Date(start)

    def per_day(i):
        d0 = start_d.advance(ee.Number(i), "day")
        sub = col.filterDate(d0, d0.advance(1, "day"))
        val = ee.Algorithms.If(
            sub.size().gt(0),
            sub.mean().reduceRegion(ee.Reducer.mean(), region, 5000, maxPixels=1e9).get(SO2_BAND),
            -9999,
        )
        return ee.Feature(None, {"t": d0.format("YYYY-MM-dd"), "v": val})

    rows = ee.FeatureCollection(ee.List.sequence(0, days - 1).map(per_day)).getInfo()["features"]
    out = []
    for r in rows:
        v = r["properties"].get("v")
        out.append({"t": r["properties"]["t"], "v": None if v is None or v == -9999 else v / DU})
    return out

AER_BAND = "absorbing_aerosol_index"

def aer_collection(start: str, end: str) -> ee.ImageCollection:
    """Sentinel-5P Absorbing Aerosol Index: smoke (and desert dust) seen from space."""
    recent = (date.today() - _d(end)).days < 10
    name = "COPERNICUS/S5P/NRTI/L3_AER_AI" if recent else "COPERNICUS/S5P/OFFL/L3_AER_AI"
    return ee.ImageCollection(name).filterDate(start, plus(end, 1)).select(AER_BAND)

def aer_image(start: str, end: str) -> ee.Image:
    col = aer_collection(start, end)
    return ee.Image(ee.Algorithms.If(col.size().gt(0), col.median(), _empty(AER_BAND)))

def aer_tile_image(start: str, end: str) -> ee.Image:
    img = aer_image(start, end)
    return img.updateMask(img.gte(VIS["smoke"]["min"]))

def aer_stats(region, start: str, end: str):
    """Mean and 90th-percentile aerosol index over the area (the 90th catches a plume over part of it)."""
    r = aer_image(start, end).reduceRegion(
        ee.Reducer.mean().combine(ee.Reducer.percentile([90]), sharedInputs=True),
        region, 5000, maxPixels=1e9, bestEffort=True).getInfo()
    return {"mean": r.get(f"{AER_BAND}_mean"), "p90": r.get(f"{AER_BAND}_p90")}

# ---- Active fires: NASA FIRMS hotspots (about 1 km) -----------------------------------
FIRE_ID = "FIRMS"
FIRE_FIRST = "2000-11-01"
FIRE_PRODUCT = "NASA FIRMS fire hotspots (~1 km)"

def fire_collection(start: str, end: str) -> ee.ImageCollection:
    return ee.ImageCollection(FIRE_ID).filterDate(start, plus(end, 1)).select(["T21", "confidence"])

def fire_image(start: str, end: str) -> ee.Image:
    """Hottest brightness temperature per pixel in the window (Kelvin); unmasked only where there was fire."""
    col = fire_collection(start, end).select("T21")
    return ee.Image(ee.Algorithms.If(col.size().gt(0), col.max(), _empty("T21"))).rename("T21")

def fire_tile_image(start: str, end: str) -> ee.Image:
    # grow each hotspot a little so it glows at every zoom level
    return fire_image(start, end).focalMax(1.5, "circle", "pixels")

def fire_pixel_count(region, start: str, end: str):
    return fire_image(start, end).reduceRegion(
        ee.Reducer.count(), region, 1000, maxPixels=1e9, bestEffort=True
    ).get("T21").getInfo()

def fire_clusters(region, start: str, end: str):
    """Separate fires in the window. Hotspot pixels that touch, or sit within one pixel (~2 km) of each
    other, are grouped into one fire, since one fire usually lights up many neighbouring 1 km pixels."""
    img = fire_image(start, end).mask().gt(0).unmask(0).clip(region)
    grouped = img.focalMax(1, "square", "pixels").selfMask().rename("zone")
    fires = ee.Image.cat(grouped, img.rename("px")).reduceToVectors(
        reducer=ee.Reducer.sum(), geometry=region, scale=1000, geometryType="centroid",
        eightConnected=True, labelProperty="zone", maxPixels=1e9, bestEffort=True, tileScale=4,
    ).filter(ee.Filter.gt("sum", 0))
    sizes = fires.aggregate_array("sum").getInfo() or []
    sizes = sorted((round(s) for s in sizes), reverse=True)
    return {"count": len(sizes), "largest_px": sizes[0] if sizes else 0, "sizes": sizes[:20]}

def fire_calendar(region, year: int, month: int):
    """Daily fire-hotspot counts in one month. Days with no satellite data stay null."""
    import calendar
    days = calendar.monthrange(year, month)[1]
    start = date(year, month, 1).isoformat()
    end = (date(year, month, days) + timedelta(days=1)).isoformat()
    col = ee.ImageCollection(FIRE_ID).filterDate(start, end).select("T21")
    start_ee = ee.Date(start)

    def daily(index):
        day = start_ee.advance(ee.Number(index), "day")
        sample = col.filterDate(day, day.advance(1, "day"))
        image = ee.Image(ee.Algorithms.If(sample.size().gt(0), sample.max(), _empty("T21")))
        count = image.reduceRegion(ee.Reducer.count(), region, 1000, maxPixels=1e9, bestEffort=True).get("T21")
        return ee.Feature(None, {"date": day.format("YYYY-MM-dd"),
                                 "count": ee.Algorithms.If(sample.size().gt(0), ee.Algorithms.If(count, count, 0), None),
                                 "observations": sample.size()})

    features = ee.FeatureCollection(ee.List.sequence(0, days - 1).map(daily)).getInfo()["features"]
    return [{"date": f["properties"]["date"], "count": f["properties"].get("count"),
             "observations": f["properties"].get("observations", 0)} for f in features]

def s2_collection(region, start: str, end: str) -> ee.ImageCollection:
    def mask(img):
        scl = img.select("SCL")
        bad = scl.eq(3).Or(scl.eq(8)).Or(scl.eq(9)).Or(scl.eq(10)).Or(scl.eq(11))
        return img.updateMask(bad.Not())

    return (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(region)
            .filterDate(start, plus(end, 1))
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 80))
            .map(mask))

def burn_windows(end: str):
    """Post-fire = the 30 days up to `end`. Pre-fire = a 60-day window ending 45 days before `end`."""
    return (plus(end, -104), plus(end, -45)), (plus(end, -29), end)

def _nbr(img):
    return img.normalizedDifference(["B8", "B12"]).rename("NBR")

def dnbr_image(region, end: str) -> ee.Image:
    (pre_a, pre_b), (post_a, post_b) = burn_windows(end)
    pre = _nbr(s2_collection(region, pre_a, pre_b).median())
    post = _nbr(s2_collection(region, post_a, post_b).median())
    dnbr = pre.subtract(post).rename("dNBR")
    return dnbr.updateMask(pre.gt(0.1)).clip(region)

def burn_tile_image(region, end: str) -> ee.Image:
    img = dnbr_image(region, end)
    return img.updateMask(img.gte(0.1))

def burned_hectares(region, end: str, radius_km: float = 50):
    """Burned hectares. Sentinel-2 is 20-30 m, but adding up a 150 km circle at 30 m means ~80 million
    pixels; the sampling scale grows with the area (30 m for small areas, ~100 m at 150 km) so it stays fast.
    Area is summed with pixelArea(), so the hectare total stays comparable across scales."""
    scale = max(30, min(120, round(radius_km * 0.65)))
    img = dnbr_image(region, end)
    area = img.gt(0.27).selfMask().multiply(ee.Image.pixelArea())
    v = area.reduceRegion(ee.Reducer.sum(), region, scale, maxPixels=1e10, bestEffort=True, tileScale=4).get("dNBR")
    v = v.getInfo()
    return 0 if v is None else v / 10000

CONFIDENCE_MIN = {"all": 0, "nominal": 30, "high": 80}

def hotspot_records(region, start: str, end: str, confidence: str = "all", limit: int = 5000):
    """One row per fire hotspot per day inside `region`, filtered by confidence."""
    col = fire_collection(start, end)
    floor = CONFIDENCE_MIN[confidence]

    def per_image(img):
        img = ee.Image(img)
        conf = img.select("confidence")
        keep = img.select("T21").mask().And(conf.gte(floor))
        stack = ee.Image.pixelLonLat().addBands(conf.rename("conf")).addBands(img.select("T21").rename("t21")).updateMask(keep)
        day = img.date().format("YYYY-MM-dd")
        pts = stack.sample(region=region, scale=1000, geometries=False, dropNulls=True, tileScale=4)
        return pts.map(lambda f: f.set("date", day))

    fc = ee.FeatureCollection(col.map(per_image)).flatten().sort("date").limit(limit)
    rows = []
    for f in fc.getInfo()["features"]:
        p = f["properties"]
        conf = p.get("conf")
        rows.append({
            "date": p.get("date"),
            "latitude": round(p["latitude"], 5) if p.get("latitude") is not None else None,
            "longitude": round(p["longitude"], 5) if p.get("longitude") is not None else None,
            "product": FIRE_PRODUCT,
            "confidence": conf,
            "confidence_class": "" if conf is None else ("high" if conf >= 80 else "nominal" if conf >= 30 else "low"),
            "brightness_k": round(p["t21"], 2) if p.get("t21") is not None else None,
        })
    return rows

def summarize_month(days, year: int, month: int):
    """Collapse one month of daily calendar counts into a summary row."""
    import calendar
    n_days = calendar.monthrange(year, month)[1]
    observed = [d for d in (days or []) if d.get("count") is not None]
    active = [d for d in observed if d["count"] > 0]
    total = sum(d["count"] for d in observed)
    peak = max(observed, key=lambda d: d["count"], default=None)
    return {
        "month": f"{year}-{month:02d}",
        "product": FIRE_PRODUCT,
        "days_in_month": n_days,
        "days_observed": len(observed),
        "days_with_fire": len(active),
        "hotspot_days": total if observed else None,
        "mean_daily_hotspots": round(total / len(observed), 2) if observed else None,
        "max_daily_hotspots": peak["count"] if peak else None,
        "peak_date": peak["date"] if peak and peak["count"] > 0 else None,
    }
