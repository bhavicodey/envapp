"use strict";
// A year of fire hotspots near your place, played back in about 25 seconds.
(function () {
  const $ = (s) => document.querySelector(s);
  const DAYS = 365, SECONDS = 26, LIFE = 26;
  const btn = $("#tl-btn"), hud = $("#tl-hud");
  let raf = 0, running = false, loading = false, points = [], t0 = 0, startMs = 0, token = 0;

  function ensureLayer() {
    if (!map.getSource("tl-fires")) map.addSource("tl-fires", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!map.getLayer("tl-fires")) {
      map.addLayer({
        id: "tl-fires", type: "circle", source: "tl-fires",
        paint: {
          "circle-color": ["interpolate", ["linear"], ["get", "age"], 0, "#ffc233", 0.15, "#ff7a1a", 1, "#a3003a"],
          "circle-radius": ["interpolate", ["linear"], ["get", "age"], 0, 11, 0.08, 6, 1, 2.5],
          "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 1, 1, 0.15],
          "circle-blur": ["interpolate", ["linear"], ["get", "age"], 0, 0.7, 1, 0],
        },
      });
    }
  }
  const clearLayer = () => map.getSource("tl-fires")?.setData({ type: "FeatureCollection", features: [] });
  function setHud(s) { hud.hidden = false; hud.dataset.state = s; }

  function stop() {
    cancelAnimationFrame(raf); raf = 0; running = false; token++;
    clearLayer(); hud.hidden = true;
    btn.disabled = !state.pin; btn.textContent = "year time-lapse";
  }

  async function load() {
    const end = iso(state.end), start = iso(state.end - (DAYS - 1) * DAY);
    const r = await api("hotspots", { ...areaParams(), start, end, confidence: "all" });
    return r.records.map((x) => ({ lat: x.latitude, lon: x.longitude, t: Date.parse(x.date + "T12:00:00Z") }))
      .filter((p) => Number.isFinite(p.t) && p.lat != null && p.lon != null).sort((a, b) => a.t - b.t);
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    const day = Math.min(DAYS, ((now - t0) / 1000) / SECONDS * DAYS), cur = startMs + day * DAY;
    const feats = []; let n = 0;
    for (const p of points) {
      if (p.t > cur) break;
      n++;
      const age = (cur - p.t) / (LIFE * DAY);
      if (age < 1) feats.push({ type: "Feature", properties: { age }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
    }
    map.getSource("tl-fires")?.setData({ type: "FeatureCollection", features: feats });
    $("#tl-date").textContent = fmt(cur).toLowerCase();
    $("#tl-n").textContent = n.toLocaleString();
    $("#tl-bar").style.width = `${day / DAYS * 100}%`;
    if (day >= DAYS) { running = false; setHud("done"); btn.disabled = false; btn.textContent = "replay"; return; }
    raf = requestAnimationFrame(frame);
  }

  async function start() {
    if (!state.pin || loading) return;
    if (running) { stop(); return; }
    window.FirePasses?.stop?.();
    const mine = ++token;
    loading = true; btn.disabled = true; btn.textContent = "loading…";
    setHud("loading");
    $("#tl-date").textContent = "loading a year of fires…"; $("#tl-n").textContent = "0"; $("#tl-bar").style.width = "0%";
    try {
      const data = await load();
      if (mine !== token) return;
      if (!data.length) { toast("No fires found here in the last year."); stop(); return; }
      points = data; startMs = state.end - (DAYS - 1) * DAY;
      ensureLayer(); setHud("playing");
      running = true; btn.textContent = "stop"; btn.disabled = false;
      t0 = performance.now(); raf = requestAnimationFrame(frame);
    } catch {
      if (mine === token) { toast("Couldn't load the time-lapse. Try again."); stop(); }
    } finally { loading = false; }
  }

  btn.addEventListener("click", start);
  $("#tl-stop").addEventListener("click", stop);
  addEventListener("firescout:area", () => { if (running || !hud.hidden) stop(); btn.disabled = !state.pin; });
  btn.disabled = !state.pin;
  window.FireTimelapse = { stop: () => { if (running || !hud.hidden) stop(); } };
})();
