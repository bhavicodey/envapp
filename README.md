# firescout

Fires, smoke and burn scars from space, 2000 to today, on one globe. Powered by Google Earth Engine.

## Run it

1. Double-click `start.bat` (Windows), `start.command` (Mac) or run `./start.sh` (Linux).
   Or in VS Code press **F5**.
2. The first time, enter your Google Cloud project ID (registered for Earth Engine) and sign in to Google once.
3. The app opens at http://127.0.0.1:8000. Add `?skip` to the address to skip the welcome screens.

## What it does

| Part | Data | What you get |
|---|---|---|
| Active fires | MODIS (FIRMS, since 2000) and VIIRS (VNP14A1, since 2012) | Hotspots on the map, fire pixels and separate fires in your area. “Both” joins them into one record. |
| Sulfur dioxide | Sentinel-5P | 7-day median map, your area vs its own 30-day normal, 30-day chart |
| Smoke | `COPERNICUS/S5P/OFFL/L3_AER_AI` (and `NRTI` for the last 10 days) | Absorbing Aerosol Index (smoke and dust), 7-day median |
| Burn scars | Sentinel-2 | Burn severity (dNBR) map and burned hectares |
| Reported fires | NIFC (US fire agencies, 2014 on) | Wildfires agencies reported in the same window |
| Burn calendar | MODIS / VIIRS | Every day of the month, colored by how much fire was detected |
| Fire history | MODIS + VIIRS | Every month since 2000, how this month compares, trend per decade |
| Satellite passes | Sentinel-5P, Sentinel-2, MODIS, VIIRS | Watch each satellite sweep over your place, drawn to scale. Sentinel times are real, from the image archive. |
| Saved | | Save readings and watched places. Kept in `data/saved.json` and in the browser. Backup and import as JSON. |
| Export | | Hotspot records, monthly summaries, calendar CSV and PNG |

Also: place search, draw your own area, play through time, a one-year fire time-lapse, color-blind safe colors, and a guided tour.

## How “Both” works

VIIRS has sharper pixels and sees more fires than MODIS. From 2012 on, firescout uses VIIRS. Before that it uses
MODIS × k, where k is the VIIRS/MODIS ratio in the months both satellites were flying over your area.
So every year is on the same scale.

## Folders

- `backend/` Python server (FastAPI + Earth Engine). `passes.py` reads real satellite pass times, `saved.py` stores saved data.
- `frontend/` the web page
- `data/` your saved places and readings (created on first save, not committed)
- `.cache/` finished months of fire data, so they load instantly next time (not committed)

## Tuning

- Alert rules: `backend/config.py`
- Map colors: `VIS` in `backend/layers.py`
- “Burned” threshold: dNBR above 0.27 in `burned_hectares()`

## Notes on the science

- Fire pixels are roughly 1 km hotspots, not individual fires.
- Sulfur dioxide also comes from volcanoes and industry, so a spike next to fires means “co-occurring”, not “caused by”.
- Sulfur dioxide is in Dobson units (1 DU = 4.46e-4 mol/m²).
