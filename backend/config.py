import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# ---- Earth Engine ----------------------------------------------------------
EE_PROJECT = os.getenv("EE_PROJECT", "").strip()
EE_SERVICE_ACCOUNT = os.getenv("EE_SERVICE_ACCOUNT", "").strip()
EE_KEY_FILE = os.getenv("EE_KEY_FILE", "").strip()
EE_KEY_JSON = os.getenv("EE_KEY_JSON", "").strip()   # for hosting: the whole service-account key

FRONTEND_DIR = ROOT / "frontend"
DATA_DIR = ROOT / "data"          # saved places and saved readings live here (data/saved.json)

# ---- Signal thresholds (tweak freely) ---------------------------------------
ALERT_MIN_FIRE_PIXELS = 1      # fires + raised SO2 together  -> "alert"
ALERT_SO2_RATIO = 1.5          # SO2 vs the area's own 30-day normal
WATCH_FIRE_PIXELS = 10         # lots of fire alone           -> "watch"
WATCH_SO2_RATIO = 2.0          # SO2 far above normal alone   -> "watch"

CACHE_SECONDS = 3600

# ---- Smoke + health card (NFTE health version) -----------------------------
# Sentinel-5P Absorbing Aerosol Index (AAI): ~0 is clean air; above ~1 means a clear layer of smoke or dust;
# above ~2 means a thick plume.
SMOKE_SOME_AAI = 1.0          # "Some smoke likely"
SMOKE_HEAVY_AAI = 2.0         # "Heavy smoke likely"
SMOKE_TRACE_AAI = 0.5         # with fire nearby -> "Fire nearby, little smoke seen"
SMOKE_FIRE_PIXELS = 10        # lots of fire nearby bumps the level up one step
