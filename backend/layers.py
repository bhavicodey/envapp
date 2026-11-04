"""Earth Engine layer builders.

Everything here returns lazy ee objects; nothing is computed until .getInfo() or getMapId().
Date windows are inclusive of both start and end (ISO strings, YYYY-MM-DD).
"""
from datetime import date, timedelta

import ee

DU = 4.4615e-4  # mol/m2 in one Dobson unit
SO2_BAND = "SO2_column_number_density"
SO2_MIN, SO2_MAX = 0.0001, 0.0008  # mol/m2 display range

VIS = {
    # pink for gas, red for fire, deep crimson for burn scars (matches the app theme)
    "so2": {"min": SO2_MIN, "max": SO2_MAX,
            "palette": ["#ffc2d6", "#ff8fb4", "#f0457f", "#c2185b", "#7a0c3a"]},
    "fire": {"min": 300, "max": 500,
             "palette": ["#ff9aa8", "#ff3b57", "#d90429", "#7b0020"]},
    "burn": {"min": 0.1, "max": 1.0,
             "palette": ["#ffd1da", "#e56b82", "#a4133c", "#4a0d1f"]},
}

META = {
    "so2": {"title": "Sulfur dioxide", "palette": VIS["so2"]["palette"],
            "legend_min": f"{SO2_MIN / DU:.1f} DU", "legend_max": f"{SO2_MAX / DU:.1f} DU"},
    "fire": {"title": "Active fires", "palette": VIS["fire"]["palette"],
             "legend_min": "300 K", "legend_max": "500 K"},
    "burn": {"title": "Burn scars", "palette": VIS["burn"]["palette"],
             "legend_min": "Low severity", "legend_max": "High severity"},
}


# ---- small helpers ----------------------------------------------------------
def _d(s: str) -> date:
    return date.fromisoformat(s)


def plus(s: str, days: int) -> str:
    return (_d(s) + timedelta(days=days)).isoformat()


def _empty(band: str) -> ee.Image:
    return ee.Image.constant(0).rename(band).selfMask()


# ---- 1. Sulfur dioxide (Sentinel-5P) ------------------------------------------
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


# ---- 2. Active fires (NASA FIRMS) -----------------------------------------------
def fire_collection(start: str, end: str) -> ee.ImageCollection:
    return ee.ImageCollection("FIRMS").filterDate(start, plus(end, 1)).select("T21")


def fire_image(start: str, end: str) -> ee.Image:
    col = fire_collection(start, end)
    return ee.Image(ee.Algorithms.If(col.size().gt(0), col.max(), _empty("T21")))


def fire_tile_image(start: str, end: str) -> ee.Image:
    # grow each hotspot a little so it glows at every zoom level
    return fire_image(start, end).focalMax(1.5, "circle", "pixels")


def fire_pixel_count(region, start: str, end: str):
    v = fire_image(start, end).reduceRegion(ee.Reducer.count(), region, 1000, maxPixels=1e9).get("T21")
    return v.getInfo()


# ---- 3. Burn scars (Sentinel-2 dNBR) --------------------------------------------
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
    return dnbr.updateMask(pre.gt(0.1)).clip(region)  # only land that was green before


def burn_tile_image(region, end: str) -> ee.Image:
    img = dnbr_image(region, end)
    return img.updateMask(img.gte(0.1))


def burned_hectares(region, end: str):
    img = dnbr_image(region, end)
    area = img.gt(0.27).selfMask().multiply(ee.Image.pixelArea())
    v = area.reduceRegion(ee.Reducer.sum(), region, 30, maxPixels=1e10, bestEffort=True).get("dNBR")
    v = v.getInfo()
    return 0 if v is None else v / 10000
