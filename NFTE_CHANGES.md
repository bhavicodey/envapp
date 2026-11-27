# FireScout → NFTE World Series of Innovation

**Challenge:** MetLife Foundation Good Health & Well-Being Challenge (SDG 3), Impact League (ages 13–24)
**Prompt:** create opportunities that make healthy living easier, accessible, and more joyful for all members of your community.
**Deadline:** December 13, 2026, 11:59 PM EST at innovation.nfte.com

## The pivot

FireScout today answers "where are the fires?". For NFTE it answers
**"Is wildfire smoke affecting the people and places I care about, and what should we do today?"**

Wildfire smoke travels hundreds of kilometres and hurts people who never see a flame, especially kids,
older adults, pregnant people, outdoor workers and anyone with asthma or heart or lung disease.

## Changes

1. **Smoke layer (new data).** Sentinel-5P Absorbing Aerosol Index (`COPERNICUS/S5P/OFFL/L3_AER_AI`,
   `NRTI` for the last 10 days), 7-day median, same pipeline as the SO2 layer. AAI picks up smoke (and desert dust)
   from space and is a far better smoke signal than SO2.
2. **Plain-language health card in the readout.** Combines fire pixels, the smoke index and SO2 vs normal into
   one of four levels: *Air looks clear from space*, *Fire nearby, little smoke seen*, *Some smoke likely*,
   *Heavy smoke likely*. Each level says who should take care and lists simple steps, based on EPA AirNow /
   CDC wildfire-smoke guidance (limit hard outdoor activity, keep windows shut, run a HEPA or box-fan filter,
   N95 outdoors on heavy days, keep medicines and asthma plans handy).
3. **"My people & places" instead of "Watched places".** Save home, Grandma's house, your school or team field.
   "Check smoke for everyone" shows each one's smoke level and pops up a note for any place with smoke.
4. **"What to do today" steps** live inside the health card, matched to the level.
5. **Honest limits, always visible.** The card says that satellite data is a few days old and is not an
   air-quality reading or emergency warning, links to AirNow.gov for the official AQI, and says to follow local
   officials and call 911 in an emergency.

Thresholds live in `backend/config.py` (`SMOKE_*`). Advice text lives in `backend/health.py`.

## Pitch outline (entry form)

- **Problem:** smoke from distant fires harms millions of people who don't know the air near them is unsafe.
- **Solution:** FireScout turns free NASA and ESA satellite data into a smoke check for the people and places you
  care about, in words anyone can understand, with what to do today.
- **Different because:** it combines fires, smoke and burn scars, compares each place to its own normal, and
  explains what it means for your health, not just an index number.
- **Who it helps first:** families with kids who have asthma, grandparents, school nurses, coaches.
- **Limits we're upfront about:** delayed satellite data, not a warning system, AirNow for official AQI.
