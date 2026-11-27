# firescout

Fires, smoke and burn scars from space, 2000 to today, on one globe. Powered by Google Earth Engine.

## Run it

1. Double-click `start.bat` (Windows), `start.command` (Mac) or run `./start.sh` (Linux).
   Or in VS Code press **F5**.
2. The first time, enter your Google Cloud project ID (registered for Earth Engine) and sign in to Google once.
3. The app opens at http://127.0.0.1:8000. Add `?skip` to the address to skip the welcome screens.

## What it does

| Part | Satellite | What you get |
|---|---|---|
| Smoke | Sentinel-5P (aerosol index) | Smoke map, smoke index for your area, and a plain-language health card with what to do today |
| Sulfur dioxide | Sentinel-5P | 7-day median map, your area vs its own 30-day normal, 30-day chart |
| Active fires | NASA FIRMS hotspots | Hotspots on the map, hotspot count and separate fires in your area |
| Burn scars | Sentinel-2 | Burn severity (dNBR) map and burned hectares |
| Reported fires | NIFC (US fire agencies, 2014 on) | Wildfires agencies reported in the same window |
| Burn calendar | NASA FIRMS | Every day of the month, colored by how much fire was seen |
| Satellite passes | Sentinel-5P, Sentinel-2 | Watch each Sentinel sweep over your place, drawn to scale, with the real times it flew over |
| Saved | | My people & places (check smoke for all of them at once) and saved readings. Kept in `data/saved.json` and in the browser. Backup and import as JSON. |
| Export | | Fire hotspot records, monthly summaries, calendar CSV and PNG |

Also: place search, draw your own area, play through time, a one-year fire time-lapse, color-blind safe colors, and a guided tour.

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
