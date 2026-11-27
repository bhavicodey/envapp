"""Plain-language smoke and health card for a place (NFTE MetLife Good Health & Well-Being version).

Turns what the satellites saw (fire pixels, the Sentinel-5P smoke index, sulfur dioxide vs normal) into one of four
levels, who should take care, and simple steps for today. The steps follow EPA AirNow and CDC wildfire-smoke advice.
This is a satellite estimate, not an air-quality (AQI) reading: the card always says so and points to AirNow.gov.
"""
from . import config

SENSITIVE = ("kids and teens, adults over 65, pregnant people, outdoor workers, "
             "and anyone with asthma or heart or lung disease")

LEVELS = {
    "clear": {
        "rank": 0, "signal": "none",
        "headline": "Air looks clear from space",
        "summary": "The satellites saw no fires and no smoke layer here in the last 7 days.",
        "who": "Everyone can enjoy normal outdoor plans.",
        "steps": ["Good day to air out the house and get outside."],
    },
    "nearby": {
        "rank": 1, "signal": "watch",
        "headline": "Fire nearby, little smoke seen",
        "summary": "There are fires in this area, but the satellites saw only a thin smoke layer, if any.",
        "who": f"Keep an eye on the sky if you're sensitive to smoke: {SENSITIVE}.",
        "steps": [
            "Check the official air quality on AirNow.gov before long outdoor activity.",
            "If you have asthma, keep your inhaler and action plan handy.",
            "Wind can change fast. Check again tomorrow.",
        ],
    },
    "some": {
        "rank": 2, "signal": "watch",
        "headline": "Some smoke likely",
        "summary": "The satellites saw a clear layer of smoke or dust over this area.",
        "who": f"Take extra care: {SENSITIVE}.",
        "steps": [
            "Swap long or hard outdoor exercise for lighter or indoor activity.",
            "Keep windows and doors closed when the air smells smoky.",
            "Run an air purifier, or make a box-fan filter with a MERV-13 furnace filter.",
            "Check the official air quality on AirNow.gov.",
        ],
    },
    "heavy": {
        "rank": 3, "signal": "alert",
        "headline": "Heavy smoke likely",
        "summary": "The satellites saw a thick smoke plume over this area.",
        "who": f"Everyone should limit time outside, and especially {SENSITIVE}.",
        "steps": [
            "Stay indoors with windows shut, and run an air purifier or box-fan filter in one 'clean room'.",
            "If you must go out, wear a well-fitting N95 mask (cloth and surgical masks don't stop smoke).",
            "Don't add indoor smoke: skip candles, frying and vacuuming.",
            "Check on grandparents, neighbors and anyone with asthma or heart or lung disease.",
            "Trouble breathing or chest pain? Get medical help. Call 911 in an emergency.",
        ],
    },
}

LIMITS = ("Satellite data is a few days old and sees the whole air column, not just the air you breathe. "
          "It is not an air-quality reading or a warning system. For the official AQI see AirNow.gov, and always "
          "follow local officials and emergency alerts.")

ORDER = ["clear", "nearby", "some", "heavy"]


def smoke_level(fire_pixels, aai_p90, so2_ratio=None):
    """Pick a level from fire pixels and the area's 90th-percentile smoke index (either can be None)."""
    fire = fire_pixels or 0
    aai = aai_p90 if aai_p90 is not None else -99
    if aai >= config.SMOKE_HEAVY_AAI:
        key = "heavy"
    elif aai >= config.SMOKE_SOME_AAI:
        key = "some"
    elif fire >= 1 or aai >= config.SMOKE_TRACE_AAI or (so2_ratio and so2_ratio >= config.WATCH_SO2_RATIO):
        key = "nearby"
    else:
        key = "clear"
    # a lot of fire right here, with at least some smoke seen, bumps the level up one step
    if fire >= config.SMOKE_FIRE_PIXELS and key in ("nearby", "some") and aai >= config.SMOKE_TRACE_AAI:
        key = ORDER[ORDER.index(key) + 1]
    return key


def card(fire_pixels, aai_p90, so2_ratio=None, aai_mean=None):
    key = smoke_level(fire_pixels, aai_p90, so2_ratio)
    lv = LEVELS[key]
    summary, headline = lv["summary"], lv["headline"]
    if aai_p90 is None:
        if key == "clear":
            headline = "No smoke reading for these dates"
            summary = "The satellites saw no fires here, but there's no smoke reading for these dates yet. Try an earlier date."
        else:
            summary = "There are fires in this area. There's no smoke reading for these dates yet, so this is based on fires alone."
    return {
        "level": key, "rank": lv["rank"], "signal": lv["signal"],
        "headline": headline, "summary": summary, "who": lv["who"], "steps": list(lv["steps"]),
        "smoke_index": aai_p90, "smoke_index_mean": aai_mean,
        "smoke_seen": aai_p90 is not None,
        "limits": LIMITS, "source": "Steps based on EPA AirNow and CDC wildfire smoke guidance.",
        "airnow": "https://www.airnow.gov/",
    }
