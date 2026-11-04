# firescout ♡

fires, sulfur dioxide and burn scars on one pink little globe, powered by google earth engine.

## run it (the easy way)

1. **unzip** the folder anywhere.
2. **double-click the starter**
   - windows: `start.bat`
   - mac: `start.command` (first time: right-click → open)
   - linux: `./start.sh`
3. the first time, it asks for your **google cloud project id** (the one registered for earth engine at
   https://code.earthengine.google.com/register) and opens a google sign-in page once. that's it.
4. your browser opens firescout automatically. answer the two cute questions and explore ♡

> prefer to set it up yourself? copy `.env.example` to `.env`, put your project id after `EE_PROJECT=`, and the starter will skip the question.

you need **python 3.10+** installed (https://www.python.org/downloads/ , tick "add python to PATH" on windows). everything else is automatic.

## what's inside

| layer | earth engine data | what it shows |
|---|---|---|
| sulfur dioxide | `COPERNICUS/S5P/OFFL/L3_SO2` (and `NRTI` for the last 10 days) | so2 column density, 7-day median, cloud-masked |
| active fires | `FIRMS` (nasa modis hotspots) | fire pixels, last 7 days |
| burn scars | `COPERNICUS/S2_SR_HARMONIZED` | dnbr burn severity, 30 days after vs. a pre-fire baseline |

click the globe to get a readout: fire pixels, so2 compared with that area's own 30-day normal, burned hectares and a 30-day so2 chart.
when fires and raised so2 show up together, the readout says so.

## things to try

- click **los angeles fires, jan 2025** under *try a place*.
- turn on **burn scars** after dropping a pin.
- press **play** to step through time three days at a time.
- pin a place, choose **watch this place**, then **check all for this date**.
- the **? how it works** button replays the quick tour any time.

## project layout

```
firescout/
├── start.bat / start.command / start.sh   one-click starters
├── run.py                 first-run setup + starts the server
├── check_ee.py            tests your earth engine connection
├── .env.example           copy to .env (run.py does this for you)
├── backend/
│   ├── config.py          thresholds, paths, env vars
│   ├── ee_client.py       earth engine start-up
│   ├── layers.py          all earth engine logic + layer colors (VIS)
│   └── main.py            fastapi endpoints + serves the frontend
└── frontend/
    ├── index.html         the app + intro questions + popups
    ├── intro.js           name → purpose → quick tour
    ├── app.js             map, layers, readout, timeline, watchlist
    └── style.css          the white / pink / red theme (colors are the variables at the top)
```

## tuning

- alert rules: `backend/config.py` (`ALERT_SO2_RATIO`, `WATCH_FIRE_PIXELS`, ...).
- map layer colors: `VIS` in `backend/layers.py` (legends update themselves).
- app colors: the `:root` variables at the top of `frontend/style.css`.
- the intro questions: `frontend/index.html` (look for `id="intro"`).
- "burned" threshold: dnbr above 0.27 in `burned_hectares()`.

## troubleshooting

| problem | fix |
|---|---|
| "set EE_PROJECT" banner | open `.env`, set your project id, restart. |
| "earth engine could not start" | run `start` again to redo the google sign-in; make sure the project is registered for earth engine and the earth engine api is enabled. |
| "no ... data for this window yet" | satellite data lags a few days. move the date earlier. |
| burn scars layer empty | pin an area first. sentinel-2 needs clear-sky images in the 30 days before the date. |
| slow first load | earth engine computes on demand. results are cached for an hour. |
| blank map | the page loads the map, fonts and tiles from the internet. check your connection. |

## notes on the science

- fire pixels are roughly 1 km modis hotspots, not individual fires.
- sulfur dioxide also comes from volcanoes and industry, so a spike next to fires means "co-occurring", not "caused by".
- so2 is shown in dobson units (1 du = 4.46e-4 mol/m²).
- dnbr is masked to land that was green before the fire (pre-fire nbr above 0.1) to cut false positives from water and bare ground.
