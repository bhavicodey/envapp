"use strict";

// Watch the two Sentinels pass over your place: Sentinel-5P (smoke, sulfur dioxide) and Sentinel-2 (burn scars).
// The sweep is drawn to scale (real altitude, swath width and direction of travel), and the times come from
// the real image archive (/api/passes).
(function () {
  const q = (s, r = document) => r.querySelector(s);
  const R_EARTH = 6371;
  const SATS = {
    s5p: {
      name: "Sentinel-5P", platform: "TROPOMI spectrometer · ESA / Copernicus", color: "#0ea5a0",
      altKm: 824, swathKm: 2600, heading: 347, scanS: 0.9, local: "≈ 1:30 pm", dir: "Heads north",
      measures: "Smoke and sulfur dioxide. Sees the whole planet every day.", api: "sentinel5p",
    },
    s2: {
      name: "Sentinel-2", platform: "MSI camera · Sentinel-2A, 2B and 2C", color: "#7c5cdb",
      altKm: 786, swathKm: 290, heading: 193, scanS: 0.35, local: "≈ 10:30 am", dir: "Heads south",
      measures: "Burn scars, the burn layer. 10–20 m detail, so it passes less often.", api: "sentinel2",
    },
  };
  const KEYS = Object.keys(SATS);
  const PASS_KM = 3600, PASS_S = 14, STAGGER_S = 1.4;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
  const empty = { type: "FeatureCollection", features: [] };

  function destination([lon, lat], bearingDeg, km) {
    const d = km / R_EARTH, b = rad(bearingDeg), p1 = rad(lat), l1 = rad(lon);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [((deg(l2) + 540) % 360) - 180, deg(p2)];
  }
  function bearing([lon1, lat1], [lon2, lat2]) {
    const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
    return (deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) + 360) % 360;
  }
  const side = (ground, hdg, km) => destination(ground, hdg + 90, km);

  let map = null, ready = false, center = null, playing = [], startT = 0, raf = 0, total = 0;
  let log = null, logKey = "", logToken = 0;

  // ---------------------------------------------------------------- map layers
  function addLayers() {
    for (const id of ["pass-track", "pass-swath", "pass-edge", "pass-scan", "pass-spot"]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: empty });
    const color = ["get", "c"];
    map.addLayer({ id: "pass-swath", type: "fill", source: "pass-swath", paint: { "fill-color": color, "fill-opacity": ["get", "a"] } });
    map.addLayer({ id: "pass-swath-edge", type: "line", source: "pass-edge", paint: { "line-color": color, "line-width": 1.2, "line-opacity": 0.55 } });
    map.addLayer({ id: "pass-track", type: "line", source: "pass-track", paint: { "line-color": color, "line-width": 1, "line-opacity": 0.4, "line-dasharray": [2, 3] } });
    map.addLayer({ id: "pass-scan", type: "line", source: "pass-scan", paint: { "line-color": color, "line-width": 2.2, "line-opacity": 0.9, "line-blur": 0.6 } });
    map.addLayer({ id: "pass-spot", type: "circle", source: "pass-spot", paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": color, "circle-stroke-width": 2 } });
  }

  function satAt(s, t) {
    const tt = t - s.offsetS, visible = tt >= 0 && tt <= PASS_S;
    const along = PASS_KM * Math.min(Math.max(tt, 0), PASS_S) / PASS_S;
    const start = destination(center, s.heading + 180, PASS_KM / 2);
    const ground = destination(start, s.heading, along);
    const hdg = bearing(ground, destination(ground, s.heading, 1));
    return { visible, along, start, ground, hdg, scan: ((t / s.scanS) % 1 + 1) % 1, progress: Math.min(1, Math.max(0, tt / PASS_S)) };
  }

  function update(t) {
    const track = [], swath = [], edge = [], scan = [], spot = [];
    for (const k of playing) {
      const s = SATS[k], p = satAt(s, t), c = s.color; s.now = p.visible ? p : null;
      if (!p.visible) continue;
      const half = s.swathKm / 2;
      const line = []; for (let i = 0; i <= 40; i++) line.push(destination(p.start, s.heading, PASS_KM * i / 40));
      track.push({ type: "Feature", properties: { c }, geometry: { type: "LineString", coordinates: line } });
      const n = 24, keep = PASS_KM * 0.45;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, p.along - keep * (i + 1) / n), b = Math.max(0, p.along - keep * i / n);
        if (b - a < 1) continue;
        const ga = destination(p.start, s.heading, a), gb = destination(p.start, s.heading, b);
        const ring = [side(ga, s.heading, -half), side(gb, s.heading, -half), side(gb, s.heading, half), side(ga, s.heading, half)];
        ring.push(ring[0]);
        swath.push({ type: "Feature", properties: { c, a: 0.12 * (1 - i / n) }, geometry: { type: "Polygon", coordinates: [ring] } });
      }
      const from = Math.max(0, p.along - keep), L = [], R = [];
      for (let i = 0; i <= 16; i++) { const g = destination(p.start, s.heading, from + (p.along - from) * i / 16); L.push(side(g, s.heading, -half)); R.push(side(g, s.heading, half)); }
      if (p.along - from > 1) edge.push({ type: "Feature", properties: { c }, geometry: { type: "MultiLineString", coordinates: [L, R] } });
      const x = -half + 2 * half * p.scan, stripe = [];
      for (let i = 0; i <= 16; i++) stripe.push(side(p.ground, p.hdg, -half + (x + half) * i / 16));
      scan.push({ type: "Feature", properties: { c }, geometry: { type: "LineString", coordinates: stripe } });
      spot.push({ type: "Feature", properties: { c }, geometry: { type: "Point", coordinates: side(p.ground, p.hdg, x) } });
    }
    const set = (id, features) => map.getSource(id)?.setData({ type: "FeatureCollection", features });
    set("pass-track", track); set("pass-swath", swath); set("pass-edge", edge); set("pass-scan", scan); set("pass-spot", spot);
    updateTags();
  }

  function updateTags() {
    for (const k of KEYS) {
      const s = SATS[k];
      if (!s.marker) {
        const el = document.createElement("div"); el.className = "pass-sat"; el.style.setProperty("--c", s.color);
        el.innerHTML = `<svg class="pass-icon" aria-hidden="true"><use href="#i-sat"/></svg><span class="pass-label"><b></b><small></small></span>`;
        el.querySelector("b").textContent = s.name; el.querySelector("small").textContent = `${s.altKm} km up · ${s.swathKm.toLocaleString()} km wide`;
        s.marker = new maplibregl.Marker({ element: el, anchor: "center" });
        s.icon = el.querySelector(".pass-icon");
      }
      if (s.now && playing.includes(k)) {
        s.marker.setLngLat(s.now.ground); s.icon.style.transform = `rotate(${s.now.hdg - map.getBearing()}deg)`;
        if (!s.marker._map) s.marker.addTo(map);
      } else s.marker.remove();
    }
  }

  // ---------------------------------------------------------------- playback
  function frame(now) {
    raf = 0;
    if (!playing.length) return;
    const t = (now - startT) / 1000;
    if (t > total) { stop(); return; }
    update(t);
    q("#pass-bar").style.width = `${Math.min(100, t / total * 100)}%`;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; playing = [];
    if (map) for (const id of ["pass-track", "pass-swath", "pass-edge", "pass-scan", "pass-spot"]) map.getSource(id)?.setData(empty);
    for (const s of Object.values(SATS)) { s.now = null; s.marker?.remove(); }
    q("#pass-hud").hidden = true;
    syncButtons();
  }
  function play(keys) {
    if (!center || !ready) { toast("Pick a place first, then watch a pass."); return; }
    if (reduce) { toast("Animations are off because your device asks for reduced motion."); return; }
    window.FireTimelapse?.stop?.();
    stop();
    playing = keys.slice();
    playing.forEach((k, i) => { SATS[k].offsetS = i * STAGGER_S; });
    total = PASS_S + (playing.length - 1) * STAGGER_S + 0.6;
    if (map.getZoom() > 5) map.easeTo({ center, zoom: 4.3, duration: 900 });
    else map.easeTo({ center, duration: 900 });
    hud();
    startT = performance.now() + 700;
    raf = requestAnimationFrame(frame);
    syncButtons();
  }

  // ---------------------------------------------------------------- real pass log
  const utc = (isoT) => new Date(isoT);
  function solar(isoT, lon) {
    const d = utc(isoT), h = (d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15 + 48) % 24;
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60) % 60, am = hh < 12;
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${am ? "am" : "pm"}`;
  }
  const dayTime = (isoT) => `${fmt(utc(isoT).getTime())}, ${isoT.slice(11, 16)} UTC`;
  function cadence(passes) {
    if (!passes || passes.length < 2) return null;
    const t = passes.map((p) => utc(p.time).getTime()).sort((a, b) => a - b), gaps = [];
    for (let i = 1; i < t.length; i++) gaps.push((t[i] - t[i - 1]) / DAY);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }

  async function loadLog(force = false) {
    const s = window.firescout.snapshot();
    if (!s.pin) { log = null; renderCards(); return; }
    const key = `${s.pin.lat.toFixed(2)},${s.pin.lon.toFixed(2)},${iso(s.end)}`;
    if (!force && key === logKey) return;
    logKey = key; log = "loading"; renderCards();
    const t = ++logToken;
    try {
      const r = await api("passes", { end: iso(s.end), lat: s.pin.lat, lon: s.pin.lon });
      if (t !== logToken) return;
      log = r;
    } catch (err) { if (t !== logToken) return; log = { error: err.message }; }
    renderCards(); hud();
  }

  function passInfo(k) {
    const s = SATS[k], pin = window.firescout.snapshot().pin;
    if (!pin) return { line: "Pick a place to see its real passes.", list: [] };
    if (log === "loading" || log === null) return { line: "Reading the image archive…", list: [], loading: true };
    if (log.error) return { line: log.error, list: [] };
    const part = log[s.api];
    if (!part || part.passes == null) return { line: part?.error || "No archive data.", list: [] };
    const ps = part.passes;
    if (!ps.length) return { line: `No passes in the ${part.days} days before ${fmt(window.firescout.snapshot().end)}.`, list: [] };
    const every = cadence(ps), last = ps[0];
    const extra = last.cloud_pct == null ? "" : ` · ${Math.round(last.cloud_pct)}% cloud`;
    const head = `Last pass ${dayTime(last.time)} (≈ ${solar(last.time, pin.lon)} local)${extra}`;
    const often = every == null ? "" : every < 0.8 ? `${ps.length} passes in ${part.days} days, more than once a day here.` : `${ps.length} passes in ${part.days} days, about every ${every < 1.5 ? "day" : `${Math.round(every)} days`} here.`;
    return { line: head, sub: often, list: ps, last };
  }

  function renderCards() {
    const box = q("#sat-list"); box.replaceChildren();
    for (const k of KEYS) {
      const s = SATS[k], info = passInfo(k);
      const card = document.createElement("article"); card.className = "sat-card"; card.style.setProperty("--c", s.color); card.dataset.sat = k;
      card.innerHTML = `
        <header><span class="sat-badge"><svg aria-hidden="true"><use href="#i-sat"/></svg></span><div><h3></h3><p class="sat-plat"></p></div></header>
        <p class="sat-measures"></p>
        <dl class="sat-facts"><div><dt>Height</dt><dd></dd></div><div><dt>Swath</dt><dd></dd></div><div><dt>Overhead</dt><dd></dd></div></dl>
        <p class="sat-log"></p><p class="sat-sub note"></p>
        <div class="sat-actions"><button type="button" class="ghost sat-play">Watch it pass</button></div>`;
      card.querySelector("h3").textContent = s.name;
      card.querySelector(".sat-plat").textContent = s.platform;
      card.querySelector(".sat-measures").textContent = s.measures;
      const dd = card.querySelectorAll("dd");
      dd[0].textContent = `${s.altKm} km`; dd[1].textContent = `${s.swathKm.toLocaleString()} km`; dd[2].textContent = s.local;
      card.querySelector(".sat-log").textContent = info.line;
      card.querySelector(".sat-log").classList.toggle("loading", !!info.loading);
      card.querySelector(".sat-sub").textContent = info.sub || "";
      if (info.list.length > 1) {
        const det = document.createElement("details"); det.className = "sat-passes";
        det.innerHTML = "<summary>All passes</summary><ol></ol>";
        const pin = window.firescout.snapshot().pin;
        info.list.slice(0, 40).forEach((p) => {
          const li = document.createElement("li");
          li.textContent = `${dayTime(p.time)} · ≈ ${solar(p.time, pin.lon)} local${p.cloud_pct == null ? "" : ` · ${Math.round(p.cloud_pct)}% cloud`}${p.spacecraft ? ` · ${p.spacecraft.replace("Sentinel-", "S")}` : ""}`;
          det.querySelector("ol").append(li);
        });
        card.querySelector(".sat-actions").before(det);
      }
      card.querySelector(".sat-play").addEventListener("click", () => play([k]));
      box.append(card);
    }
    syncButtons();
  }

  function hud() {
    if (!playing.length) return;
    const box = q("#pass-hud"), ul = q("#pass-hud-list"); box.hidden = false; ul.replaceChildren();
    q("#pass-hud-title").textContent = playing.length > 1 ? "Both Sentinels passing over" : `${SATS[playing[0]].name} passing over`;
    for (const k of playing) {
      const s = SATS[k], info = passInfo(k), li = document.createElement("li");
      li.style.setProperty("--c", s.color);
      li.innerHTML = "<i></i><div><b></b><small></small></div>";
      li.querySelector("b").textContent = `${s.name} · ${s.swathKm.toLocaleString()} km swath`;
      li.querySelector("small").textContent = info.last ? `Replaying the real pass of ${dayTime(info.last.time)}` : `${s.dir} · overhead ${s.local}`;
      ul.append(li);
    }
  }

  function syncButtons() {
    const on = !!center && ready;
    document.querySelectorAll(".sat-play").forEach((b) => {
      const k = b.closest(".sat-card").dataset.sat, now = playing.includes(k);
      b.disabled = !on; b.textContent = now ? "Passing…" : "Watch it pass"; b.classList.toggle("on", now);
    });
    const all = q("#pass-all"); all.disabled = !on; all.textContent = playing.length > 1 ? "Stop" : "Watch both pass";
    q("#pass-note").textContent = on ? "Each sweep is drawn to scale: real height, swath width and direction. The times are real, from the image archive."
      : "Pick a place, then watch each Sentinel sweep across it.";
  }

  // ---------------------------------------------------------------- wiring
  const passesTabOpen = () => !q('[data-panel="passes"]').hidden;
  let dateTimer;
  function onArea() {
    const pin = window.firescout.snapshot().pin;
    center = pin ? [pin.lon, pin.lat] : null;
    if (playing.length) stop();
    if (passesTabOpen()) loadLog(); else { logKey = ""; log = null; renderCards(); }
  }
  addEventListener("firescout:area", onArea);
  addEventListener("firescout:date", () => { clearTimeout(dateTimer); dateTimer = setTimeout(() => { if (passesTabOpen()) loadLog(); else logKey = ""; }, 800); });
  addEventListener("firescout:tab", (e) => { if (e.detail === "passes") loadLog(); });
  q("#pass-all").addEventListener("click", () => (playing.length > 1 ? stop() : play(KEYS)));
  q("#pass-stop").addEventListener("click", stop);

  async function start() {
    map = window.firescoutMap; if (!map) return;
    renderCards();
    await new Promise((r) => { if (map.loaded()) return r(); map.once("load", r); });
    addLayers(); ready = true;
    onArea();
  }
  start();
  window.FirePasses = { play, stop, SATS };
})();
