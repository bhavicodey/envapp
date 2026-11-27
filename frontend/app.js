"use strict";

if (typeof maplibregl === "undefined") {
  const b = document.getElementById("setup");
  b.hidden = false;
  b.textContent = "The map couldn't load. Check your internet connection and refresh the page.";
  throw new Error("maplibre-gl failed to load");
}

// ---------------------------------------------------------------- constants
const DAY = 86400000;
const FIRST = { modis: Date.UTC(2000, 10, 1), viirs: Date.UTC(2012, 0, 19), harmonized: Date.UTC(2000, 10, 1) };
let MIN_DATE = FIRST.harmonized;
const LATEST = (() => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - 3 * DAY; })();
const ORDER = ["so2", "smoke", "burn", "fire"];             // bottom -> top
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmt = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampDate = (ms) => Math.min(LATEST, Math.max(MIN_DATE, ms));
const wrapLng = (l) => ((l + 540) % 360) - 180;
const place = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;

const state = {
  end: LATEST,
  sensor: (() => { try { const s = JSON.parse(localStorage.getItem("firescout.profile") || "null")?.sensor; return FIRST[s] ? s : "harmonized"; } catch { return "harmonized"; } })(),
  poly: null,
  placeName: "",
  calendarMonth: null,
  calendarToken: 0,
  calendarDays: null,
  pin: null,
  radius: 150,
  drawing: false,
  layers: { so2: { on: true, opacity: 0.7 }, smoke: { on: true, opacity: 0.65 }, fire: { on: true, opacity: 1 }, burn: { on: false, opacity: 0.9 } },
  tokens: { so2: 0, smoke: 0, fire: 0, burn: 0, read: 0 },
  playing: false,
  spinning: !reduceMotion,
  readout: { ins: null, series: [], loading: false, reported: null },
};

// ---------------------------------------------------------------- api + ui helpers
let pending = 0;
async function api(path, params = {}, opts = {}) {
  pending++; document.body.classList.add("loading");
  try {
    const qs = Object.keys(params).length ? `?${new URLSearchParams(params)}` : "";
    const res = await fetch(`/api/${path}${qs}`, opts);
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : msg; } catch { /* keep statusText */ }
      throw new Error(msg);
    }
    return await res.json();
  } finally {
    if (--pending === 0) document.body.classList.remove("loading");
  }
}

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 5200);
}
window.toast = toast;
function setStatus(name, text, kind = "") {
  const el = $(`.layer[data-layer="${name}"] .status`); el.textContent = text; el.dataset.kind = kind;
}

function notifyReadout() { window.dispatchEvent(new CustomEvent("firescout:readout")); }
const placeLabel = () => !state.pin ? "" : state.placeName || (state.poly ? `Drawn area near ${place(state.pin.lat, state.pin.lon)}` : place(state.pin.lat, state.pin.lon));
window.firescout = {
  fmt, iso, DAY, drawSpark: (rows, cv) => drawSpark(rows, cv),
  snapshot: () => ({
    pin: state.pin, radius: state.radius, end: state.end, sensor: state.sensor,
    place: placeLabel(),
    ins: state.readout.ins, series: state.readout.series, loading: state.readout.loading,
    poly: state.poly, reported: state.readout.reported,
  }),
};

function areaParams() {
  const p = { lat: state.pin.lat, lon: state.pin.lon, radius_km: state.radius };
  if (state.poly) p.geom = JSON.stringify(state.poly.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]));
  return p;
}

// ---------------------------------------------------------------- map
const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [-100, 28], zoom: innerWidth < 820 ? 0.9 : 1.6,
  attributionControl: { compact: true },
});
window.firescoutMap = map;
map.on("style.load", () => {
  map.setProjection({ type: "globe" });
  try { map.setSky({ "sky-color": "#06070b", "horizon-color": "#1a2236", "fog-color": "#0b0e16", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] }); } catch { /* older builds */ }
  tintBasemap();
});

// a calm night-earth basemap, so fire, smoke and burn colors are the brightest things on screen
const EARTH = {
  land: "#141822", green: "#151a23", forest: "#161b24", ice: "#1c2130", sea: "#0a0d14", river: "#121826",
  building: "#1b2030", road: "#232a3a", border: "#3b4560", label: "#9aa3b8", seaLabel: "#4f5a72", halo: "rgba(8,10,16,.9)",
};
function tintBasemap() {
  const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch { /* not every layer has it */ } };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === "background") set(id, "background-color", EARTH.land);
    else if (l.type === "fill") {
      if (/water/.test(id)) set(id, "fill-color", EARTH.sea);
      else if (/glacier|ice|snow/.test(id)) set(id, "fill-color", EARTH.ice);
      else if (/wood|forest/.test(id)) set(id, "fill-color", EARTH.forest);
      else if (/park|landcover|grass|nature|reserve|farm/.test(id)) set(id, "fill-color", EARTH.green);
      else if (/building/.test(id)) set(id, "fill-color", EARTH.building);
    } else if (l.type === "line") {
      if (/boundary|admin/.test(id)) set(id, "line-color", EARTH.border);
      else if (/waterway/.test(id)) set(id, "line-color", EARTH.river);
      else if (/highway|road|street|tunnel|bridge|motorway|path|rail/.test(id)) set(id, "line-color", EARTH.road);
    } else if (l.type === "symbol") {
      const sea = /water|ocean|sea|marine/.test(id);
      set(id, "text-color", sea ? EARTH.seaLabel : EARTH.label); set(id, "text-halo-color", EARTH.halo);
    }
  }
}

const pinEl = document.createElement("div");
pinEl.className = "pin"; pinEl.innerHTML = "<span></span>";
const marker = new maplibregl.Marker({ element: pinEl });

function circle(lat, lon, km, n = 96) {
  const R = 6371, d = km / R, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180, pts = [];
  for (let i = 0; i <= n; i++) {
    const b = 2 * Math.PI * i / n;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    pts.push([l2 * 180 / Math.PI, p2 * 180 / Math.PI]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] } };
}
const areaShape = () => state.poly
  ? { type: "Feature", geometry: { type: "Polygon", coordinates: [[...state.poly, state.poly[0]]] } }
  : circle(state.pin.lat, state.pin.lon, state.radius);

function beforeIdFor(name) {
  for (const n of ORDER.slice(ORDER.indexOf(name) + 1)) if (map.getLayer("L-" + n)) return "L-" + n;
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id || "area-fill";
}
function removeRaster(name) {
  if (map.getLayer("L-" + name)) map.removeLayer("L-" + name);
  if (map.getSource("S-" + name)) map.removeSource("S-" + name);
}
function setRaster(name, url) {
  removeRaster(name);
  map.addSource("S-" + name, { type: "raster", tiles: [url], tileSize: 256, maxzoom: 12 });
  map.addLayer({
    id: "L-" + name, type: "raster", source: "S-" + name,
    paint: { "raster-opacity": state.layers[name].opacity, "raster-resampling": name === "so2" || name === "smoke" ? "linear" : "nearest" },
  }, beforeIdFor(name));
}

// ---------------------------------------------------------------- layers
const windowNote = (name) => name === "burn"
  ? `30 days to ${fmt(state.end)}, within ${Math.min(state.radius, 150)} km`
  : `7 days to ${fmt(state.end)}`;

function tileParams() {
  const p = { start: iso(state.end - 6 * DAY), end: iso(state.end), radius_km: state.radius, sensor: state.sensor };
  if (state.pin) Object.assign(p, areaParams());
  return p;
}

async function loadLayer(name) {
  const token = ++state.tokens[name];
  const row = $(`.layer[data-layer="${name}"]`);
  if (!state.layers[name].on) { removeRaster(name); setStatus(name, ""); row.classList.remove("busy"); return; }
  if (name === "burn" && !state.pin) { removeRaster(name); setStatus(name, "Pick a place first."); return; }
  setStatus(name, "Loading…"); row.classList.add("busy");
  try {
    const { url } = await api(`tiles/${name}`, tileParams());
    if (token !== state.tokens[name]) return;
    setRaster(name, url); setStatus(name, windowNote(name));
  } catch (err) {
    if (token !== state.tokens[name]) return;
    removeRaster(name); setStatus(name, err.message, "warn");
  } finally {
    if (token === state.tokens[name]) row.classList.remove("busy");
  }
}

async function refreshAll() {
  updateTimelineText();
  await Promise.all([...ORDER.map(loadLayer), state.pin ? analyze() : null]);
}
let refreshTimer;
const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshAll, 300); };

// ---------------------------------------------------------------- pin + readout
function setPin(lat, lon, { refresh = true, poly = null, name = "" } = {}) {
  state.pin = { lat, lon };
  state.poly = poly;
  state.placeName = name;
  marker.setLngLat([lon, lat]).addTo(map);
  map.getSource("area")?.setData(areaShape());
  $("#place").textContent = placeLabel();
  $("#place-sub").textContent = poly ? "Inside your drawn shape" : `Within ${state.radius} km`;
  $("#area-note").textContent = poly ? `Using your drawn area (${poly.length} corners). Click the map to go back to a circle.` : "";
  ["#watch-add", "#reading-save"].forEach((s) => { $(s).disabled = false; });
  document.body.classList.add("has-pin");
  state.readout = { ins: null, series: [], loading: false, reported: null }; notifyReadout();
  window.dispatchEvent(new CustomEvent("firescout:area"));
  window.dispatchEvent(new CustomEvent("firescout:pin"));
  if (refresh) refreshAll();
  loadCalendar();
}

function setText(sel, text) { const el = $(sel); if (el.firstChild?.nodeType === 3) el.firstChild.textContent = text; else el.prepend(text); }

async function analyze() {
  if (!state.pin) return;
  const token = ++state.tokens.read, { lat, lon } = state.pin;
  $("#readout").classList.add("busy");
  state.readout = { ins: null, series: [], loading: true, reported: null }; notifyReadout();
  let burnVal;
  const area = areaParams();

  $("#v-fire").textContent = "…"; setText("#v-fires", "…"); $("#n-fires").textContent = "";
  setText("#v-so2", "…"); $("#n-so2").textContent = ""; $("#v-burn").textContent = "…";
  setText("#v-smoke", "…"); $("#n-smoke").textContent = ""; $("#health").hidden = true;
  const sig = $("#signal"); sig.dataset.level = "none"; sig.classList.remove("seen"); sig.textContent = "Reading the satellites…";
  $("#place-sub").textContent = `${state.poly ? "Inside your drawn shape" : `Within ${state.radius} km`} · 7 days to ${fmt(state.end)}`;

  const insP = api("insights", { ...area, end: iso(state.end), sensor: state.sensor, start: iso(state.end - 6 * DAY), include_burn: false });
  const serP = api("so2_series", { ...area, end: iso(state.end), days: 30 });
  const burnP = api("burned", { ...area, end: iso(state.end) });
  $("#v-burn").textContent = "Measuring…";

  // wildfires US agencies reported in the same window, next to what the satellites saw
  setText("#v-reported", "…"); $("#n-reported").textContent = "";
  const inUS = state.poly ? state.poly.some(([x, y]) => inUSBox(y, x)) : inUSBox(lat, lon);
  if (!inUS) { setText("#v-reported", "US only"); $("#n-reported").textContent = "Agency reports cover the United States"; }
  else if (state.end < Date.UTC(2014, 0, 1)) { setText("#v-reported", "From 2014"); $("#n-reported").textContent = "US agency records start in 2014"; }
  else api("reported", { ...area, start: iso(state.end - 6 * DAY), end: iso(state.end) }).then((rep) => {
    if (token !== state.tokens.read) return;
    state.readout.reported = rep; renderReported(rep); notifyReadout();
  }).catch(() => { if (token === state.tokens.read) { setText("#v-reported", "No data"); $("#n-reported").textContent = ""; } });

  burnP.then((b) => {
    if (token !== state.tokens.read) return;
    burnVal = b.burned_ha;
    $("#v-burn").textContent = b.burned_ha == null ? "No data" : `${Math.round(b.burned_ha).toLocaleString()} ha`;
    if (state.readout.ins) { state.readout.ins = { ...state.readout.ins, burned_ha: b.burned_ha }; notifyReadout(); }
  }).catch(() => { if (token === state.tokens.read) { burnVal = null; $("#v-burn").textContent = "No data"; } });

  serP.then((rows) => {
    if (token !== state.tokens.read) return;
    drawSpark(rows); state.readout.series = rows;
    $("#spark-cap").textContent = `Daily sulfur dioxide (Dobson units), 30 days to ${fmt(state.end)}`;
  }).catch(() => { if (token === state.tokens.read) drawSpark([]); });

  try {
    const ins = await insP;
    if (token !== state.tokens.read) return;
    const { burned_ha: _skip, ...fast } = ins;
    renderInsights(fast);
    state.readout = { ...state.readout, ins: { ...fast, burned_ha: burnVal ?? null }, loading: false };
  } catch (err) {
    if (token !== state.tokens.read) return;
    renderInsights(null); toast(err.message);
    state.readout = { ...state.readout, ins: null, loading: false };
  }
  $("#readout").classList.remove("busy");
  notifyReadout();
}

// rough boxes around the lower 48, Alaska and Hawaii, where the NIFC agency records apply
function inUSBox(lat, lon) {
  return (lat > 24 && lat < 50 && lon > -125.5 && lon < -66) || (lat > 51 && lat < 72 && lon > -180 && lon < -129) || (lat > 18.5 && lat < 22.5 && lon > -161 && lon < -154);
}

function renderReported(rep) {
  if (!rep || rep.count == null) { setText("#v-reported", "No data"); $("#n-reported").textContent = ""; return; }
  setText("#v-reported", rep.count.toLocaleString());
  const big = rep.fires.find((f) => f.acres) || rep.fires[0];
  const large = rep.fires.filter((f) => f.acres >= 100).length;
  $("#n-reported").textContent = !rep.count ? "No wildfires reported here" : big?.acres
    ? `${large} over 100 acres · biggest: ${big.name}, ${Math.round(big.acres).toLocaleString()} acres` : "Small incidents only";
  $("#v-reported").title = rep.fires.slice(0, 8).map((f) => `${f.name} · found ${f.discovered}${f.acres ? ` · ${Math.round(f.acres).toLocaleString()} acres` : ""}`).join("\n")
    + "\nSource: NIFC wildfire incidents reported by US fire agencies";
}

function renderInsights(r) {
  const sig = $("#signal");
  if (!r) { sig.dataset.level = "none"; sig.classList.remove("seen"); sig.textContent = "No reading for this window."; $("#v-fire").textContent = "No data"; setText("#v-fires", "No data"); $("#n-fires").textContent = ""; setText("#v-so2", "No data"); setText("#v-smoke", "No data"); $("#health").hidden = true; return; }
  setText("#v-smoke", r.smoke_index == null ? "No data" : r.smoke_index.toFixed(1));
  $("#n-smoke").textContent = r.smoke_index == null ? "" : smokeWords(r.smoke_index);
  renderHealth(r.health);
  $("#v-fire").textContent = r.fire_pixels == null ? "No data" : r.fire_pixels.toLocaleString();
  setText("#v-fires", r.fire_count == null ? "No data" : r.fire_count.toLocaleString());
  $("#n-fires").textContent = !r.fire_count ? "" : `Biggest ≈ ${r.largest_fire_px.toLocaleString()} km²`;
  $("#v-fires").title = "Hotspot pixels that touch, or sit within ~2 km of each other, count as one fire";
  if (r.sensor_used) $("#v-fire").title = `Read from ${r.sensor_used.toUpperCase()}${r.sensor === "harmonized" ? " (both satellites)" : ""}`;
  setText("#v-so2", r.so2_du == null ? "No data" : `${r.so2_du.toFixed(2)} DU`);
  $("#n-so2").textContent = r.so2_ratio == null ? "" : `${r.so2_ratio.toFixed(1)}× the 30-day normal`;
  if (r.burned_ha !== undefined) $("#v-burn").textContent = r.burned_ha == null ? "No data" : `${Math.round(r.burned_ha).toLocaleString()} ha`;
  sig.dataset.level = r.signal; sig.classList.add("seen"); sig.textContent = r.signal_reason;
}

// how the smoke index reads in everyday words
function smokeWords(v) {
  if (v >= 2) return "Thick smoke plume";
  if (v >= 1) return "Clear layer of smoke or dust";
  if (v >= 0.5) return "A little haze";
  return "Clean air column";
}

// the plain-language smoke and health card (NFTE MetLife Good Health & Well-Being version)
function renderHealth(h) {
  const box = $("#health");
  if (!h) { box.hidden = true; return; }
  box.dataset.level = h.level;
  $("#health-head").textContent = h.headline;
  $("#health-summary").textContent = h.summary;
  $("#health-who").textContent = h.who;
  $("#health-steps").replaceChildren(...h.steps.map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
  $("#health-limits").textContent = h.limits;
  $("#health-source").textContent = h.source;
  box.hidden = false;
}

function drawSpark(rows, cv = $("#spark")) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const vals = rows.map((r) => r.v), ok = vals.filter((v) => v != null);
  const css = getComputedStyle(document.documentElement), col = css.getPropertyValue("--so2").trim(), mut = css.getPropertyValue("--muted").trim();
  if (ok.length < 2) { g.fillStyle = mut; g.font = "12px Inter, sans-serif"; g.fillText("Not enough clear-sky days to chart.", 4, h / 2); return; }
  const lo = Math.min(0, ...ok), hi = Math.max(...ok) * 1.15 || 1;
  const x = (i) => 4 + i * (w - 8) / (rows.length - 1), y = (v) => h - 6 - (v - lo) / (hi - lo) * (h - 14);
  g.strokeStyle = mut; g.globalAlpha = .35; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(4, y(0)); g.lineTo(w - 4, y(0)); g.stroke();
  g.setLineDash([]); g.globalAlpha = 1;
  // soft area under the line
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, col + "55"); grad.addColorStop(1, col + "00");
  let open = false, seg = [];
  const flush = () => {
    if (seg.length > 1) {
      g.beginPath(); g.moveTo(seg[0][0], y(0)); seg.forEach(([a, b]) => g.lineTo(a, b)); g.lineTo(seg.at(-1)[0], y(0)); g.closePath(); g.fillStyle = grad; g.fill();
      g.beginPath(); seg.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
    }
    seg = [];
  };
  vals.forEach((v, i) => { if (v == null) { open = false; flush(); return; } seg.push([x(i), y(v)]); open = true; });
  flush();
  const last = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
  g.fillStyle = col; g.beginPath(); g.arc(x(last), y(vals[last]), 3.5, 0, 7); g.fill();
}

// ---------------------------------------------------------------- timeline
const slider = $("#slider"), dateInput = $("#date");
function configureDateLimits() { slider.max = Math.round((LATEST - MIN_DATE) / DAY); dateInput.min = iso(MIN_DATE); dateInput.max = iso(LATEST); }
configureDateLimits();

function updateTimelineText() {
  slider.value = Math.round((state.end - MIN_DATE) / DAY);
  slider.style.setProperty("--fill", `${(slider.value / slider.max) * 100}%`);
  dateInput.value = iso(state.end);
  $("#window-note").textContent = `Fires and SO₂: 7 days to ${fmt(state.end)} · Burn scars: 30 days`;
}
function setDate(ms, { refresh = true } = {}) {
  state.end = clampDate(ms); updateTimelineText();
  if (refresh) scheduleRefresh();
  window.dispatchEvent(new CustomEvent("firescout:date"));
  if (state.pin) { const d = new Date(state.end); const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; if (ym !== state.calendarMonth) loadCalendar(); else markChosenDay(); }
}
slider.addEventListener("input", () => { state.end = clampDate(MIN_DATE + slider.value * DAY); dateInput.value = iso(state.end); slider.style.setProperty("--fill", `${(slider.value / slider.max) * 100}%`); });
slider.addEventListener("change", () => setDate(MIN_DATE + slider.value * DAY));
dateInput.addEventListener("change", () => dateInput.value && setDate(Date.parse(dateInput.value)));
$("#prev-day").addEventListener("click", () => setDate(state.end - DAY));
$("#next-day").addEventListener("click", () => setDate(state.end + DAY));

function setPlayBtn(playing) {
  const b = $("#play");
  b.querySelector("span").textContent = playing ? "Pause" : "Play";
  b.querySelector("path").setAttribute("d", playing ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z");
  b.classList.toggle("on", playing);
}
async function togglePlay() {
  if (state.playing) { state.playing = false; setPlayBtn(false); return; }
  state.playing = true; setPlayBtn(true);
  if (state.end + 3 * DAY > LATEST) setDate(LATEST - 30 * DAY, { refresh: false });
  while (state.playing && state.end + 3 * DAY <= LATEST) {
    setDate(state.end + 3 * DAY, { refresh: false });
    await refreshAll(); await sleep(500);
  }
  state.playing = false; setPlayBtn(false);
}
$("#play").addEventListener("click", togglePlay);

// ---------------------------------------------------------------- controls
$$(".layer").forEach((row) => {
  const name = row.dataset.layer;
  $("input[type=checkbox]", row).addEventListener("change", (e) => { state.layers[name].on = e.target.checked; row.classList.toggle("off", !e.target.checked); loadLayer(name); });
  $(".opacity", row).addEventListener("input", (e) => {
    state.layers[name].opacity = +e.target.value;
    if (map.getLayer("L-" + name)) map.setPaintProperty("L-" + name, "raster-opacity", +e.target.value);
  });
  row.classList.toggle("off", !state.layers[name].on);
});
function setLayerOn(name, on) {
  state.layers[name].on = on;
  const row = $(`.layer[data-layer="${name}"]`);
  $("input[type=checkbox]", row).checked = on; row.classList.toggle("off", !on);
}
function setRadius(km) { state.radius = km; $("#radius").value = km; $("#radius-val").textContent = `${km} km`; }

$("#radius").addEventListener("input", (e) => { $("#radius-val").textContent = `${e.target.value} km`; });
$("#radius").addEventListener("change", (e) => { state.radius = +e.target.value; if (state.pin && !state.poly) setPin(state.pin.lat, state.pin.lon, { name: state.placeName }); });

$$(".presets button").forEach((b) => b.addEventListener("click", () => {
  if (b.disabled) return;
  stopSpin();
  const lat = +b.dataset.lat, lon = +b.dataset.lon;
  setRadius(+b.dataset.radius);
  setLayerOn("so2", true); setLayerOn("smoke", true); setLayerOn("fire", true); setLayerOn("burn", b.dataset.burn === "1");
  setDate(Date.parse(b.dataset.date), { refresh: false });
  setPin(lat, lon, { refresh: false, name: b.querySelector("b")?.textContent || "" });
  map.flyTo({ center: [lon, lat], zoom: +b.dataset.zoom, duration: reduceMotion ? 0 : 2400 });
  refreshAll();
}));

map.on("click", (e) => {
  if (state.drawing) return;
  stopSpin();
  setPin(e.lngLat.lat, wrapLng(e.lngLat.lng));
});

$$(".panel-toggle").forEach((btn) => btn.addEventListener("click", () => {
  const p = btn.closest(".panel"); const c = p.classList.toggle("collapsed"); btn.setAttribute("aria-expanded", String(!c));
  // on phones only one panel is open at a time, so they never cover each other
  if (!c && innerWidth <= 820) $$(".panel").forEach((other) => {
    if (other !== p && other.querySelector(".panel-toggle") && !other.classList.contains("collapsed")) { other.classList.add("collapsed"); other.querySelector(".panel-toggle").setAttribute("aria-expanded", "false"); }
  });
}));
if (innerWidth < 820) $$(".panel-toggle").forEach((b) => b.click());

// ---------------------------------------------------------------- globe spin (stops at first touch)
function spin() {
  if (!state.spinning || map.getZoom() > 3) return;
  const c = map.getCenter(); c.lng += 8;
  map.easeTo({ center: c, duration: 1000, easing: (t) => t });
}
function stopSpin() { state.spinning = false; $("#spin")?.setAttribute("aria-pressed", "false"); hideHint(); }
["mousedown", "touchstart", "wheel", "keydown"].forEach((ev) => map.getCanvas().addEventListener(ev, stopSpin, { passive: true }));
const hideHint = () => $("#hint")?.classList.add("gone");
map.on("moveend", spin);

const HOME = { center: [-100, 28], zoom: innerWidth < 820 ? 0.9 : 1.6, bearing: 0, pitch: 0 };
const ease = reduceMotion ? 0 : 600;
$("#spin").setAttribute("aria-pressed", String(state.spinning));
$("#zoom-in").addEventListener("click", () => { stopSpin(); map.zoomIn({ duration: ease }); });
$("#zoom-out").addEventListener("click", () => { stopSpin(); map.zoomOut({ duration: ease }); });
$("#compass").addEventListener("click", () => { stopSpin(); map.resetNorthPitch({ duration: ease }); });
$("#home").addEventListener("click", () => { stopSpin(); map.flyTo({ ...HOME, duration: reduceMotion ? 0 : 1600 }); });
$("#spin").addEventListener("click", () => {
  state.spinning = !state.spinning;
  $("#spin").setAttribute("aria-pressed", String(state.spinning));
  if (state.spinning) { if (map.getZoom() > 3) map.flyTo({ ...HOME, duration: reduceMotion ? 0 : 1600 }); else spin(); }
});
let flat = false;
$("#proj").addEventListener("click", () => {
  flat = !flat; stopSpin();
  map.setProjection({ type: flat ? "mercator" : "globe" });
  const b = $("#proj");
  b.setAttribute("aria-label", flat ? "Switch to globe" : "Switch to flat map"); b.dataset.tip = flat ? "Globe" : "Flat map";
  b.setAttribute("aria-pressed", String(flat));
});
map.on("rotate", () => { const c = $("#compass svg"); if (c) c.style.transform = `rotate(${-map.getBearing()}deg)`; });
map.on("dragstart", hideHint); map.on("click", hideHint);
setTimeout(hideHint, 25000);

// ---------------------------------------------------------------- name popup (used for places and readings)
function askName(def, title = "Name this place") {
  return new Promise((resolve) => {
    const m = $("#namer"), input = $("#namer-input"), form = $("#namer-form"), cancel = $("#namer-cancel");
    $("#n-title").textContent = title;
    input.value = def; m.hidden = false; input.focus(); input.select();
    const ac = new AbortController();
    const done = (v) => { ac.abort(); m.hidden = true; resolve(v); };
    form.addEventListener("submit", (e) => { e.preventDefault(); done(input.value.trim()); }, { signal: ac.signal });
    cancel.addEventListener("click", () => done(""), { signal: ac.signal });
    m.addEventListener("click", (e) => { if (e.target === m) done(""); }, { signal: ac.signal });
    m.addEventListener("keydown", (e) => { if (e.key === "Escape") done(""); }, { signal: ac.signal });
  });
}

// jump to a saved place or reading
function goToArea({ lat, lon, radius, poly, name, date }) {
  stopSpin();
  if (radius) setRadius(radius);
  if (date) setDate(Date.parse(date), { refresh: false });
  setPin(lat, lon, { poly: poly || null, name: name || "" });
  if (poly) {
    const b = poly.reduce((bb, p) => [Math.min(bb[0], p[0]), Math.min(bb[1], p[1]), Math.max(bb[2], p[0]), Math.max(bb[3], p[1])], [180, 90, -180, -90]);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 120, duration: reduceMotion ? 0 : 1400, maxZoom: 9 });
  } else map.flyTo({ center: [lon, lat], zoom: Math.max(5, 9 - Math.log2((radius || state.radius) / 25)), duration: reduceMotion ? 0 : 1800 });
}

// ---------------------------------------------------------------- fire satellite
const SENSOR_DETAILS = {
  harmonized: "MODIS before 2012, VIIRS after, on one scale · 2000 to today.",
  modis: "MODIS only (Terra + Aqua) · since 2000 · ~1 km pixels.",
  viirs: "VIIRS only (Suomi NPP + NOAA-20) · since 2012 · sees smaller fires.",
};
const SENSOR_CAPTION = { harmonized: "MODIS + VIIRS hotspots", modis: "MODIS hotspots", viirs: "VIIRS fire detections" };
const SENSOR_NAME = { harmonized: "both satellites", modis: "MODIS", viirs: "VIIRS" };
function selectSensor(sensor) {
  if (!FIRST[sensor]) return;
  state.sensor = sensor;
  MIN_DATE = FIRST[sensor];
  configureDateLimits();
  state.end = clampDate(state.end);
  $$(".sensor-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sensor === sensor)));
  $("#sensor-detail").textContent = SENSOR_DETAILS[sensor];
  $("#fire-source-caption").textContent = SENSOR_CAPTION[sensor];
  const fireRow = $('.layer[data-layer="fire"]');
  const LEG = { modis: ["linear-gradient(90deg,var(--modis),var(--modis))", "MODIS", ""], viirs: ["linear-gradient(90deg,var(--viirs),var(--viirs))", "", "VIIRS"],
    harmonized: ["linear-gradient(90deg,var(--modis) 0 40%,var(--both) 40% 60%,var(--viirs) 60% 100%)", "MODIS", "VIIRS · orange = both"] }[sensor];
  $(".bar", fireRow).style.background = LEG[0]; $(".lo", fireRow).textContent = LEG[1]; $(".hi", fireRow).textContent = LEG[2]; fireRow.dataset.legendSet = "1";
  try { const p = JSON.parse(localStorage.getItem("firescout.profile") || "{}"); p.sensor = sensor; localStorage.setItem("firescout.profile", JSON.stringify(p)); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent("firescout:sensor-changed"));
  $("#v-fire").textContent = "–";
  updateTimelineText();
  loadCalendar();
  loadLayer("fire");
  if (state.pin) analyze();
}
$$(".sensor-switch button").forEach((b) => b.addEventListener("click", () => selectSensor(b.dataset.sensor)));
window.addEventListener("firescout:sensor", (e) => selectSensor(e.detail));

// ---------------------------------------------------------------- burn calendar
function calendarMonthParts() { const d = new Date(state.end); return [d.getUTCFullYear(), d.getUTCMonth() + 1]; }
function markChosenDay() { $$("#fire-calendar .cal-day").forEach((b) => b.classList.toggle("chosen", b.dataset.date === iso(state.end))); }
function showCalendar(days, year, month) {
  const box = $("#fire-calendar"); box.replaceChildren();
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  for (let i = 0; i < offset; i++) { const blank = document.createElement("span"); blank.className = "cal-blank"; box.append(blank); }
  const maximum = Math.max(1, ...days.map((d) => d.count || 0));
  for (const d of days) {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "cal-day"; btn.dataset.date = d.date;
    const day = Number(d.date.slice(-2));
    const hasData = d.count !== null && d.count !== undefined;
    btn.dataset.intensity = !hasData ? "missing" : !d.count ? "0" : String(Math.min(4, Math.max(1, Math.ceil(4 * d.count / maximum))));
    const shown = hasData ? (Number.isInteger(d.count) ? d.count.toLocaleString() : d.count.toFixed(1)) : "";
    btn.innerHTML = `<span class="d"></span><span class="c"></span>`;
    btn.firstChild.textContent = day; btn.lastChild.textContent = hasData && d.count ? (d.count >= 1000 ? `${(d.count / 1000).toFixed(1)}k` : Math.round(d.count)) : "";
    const src = d.source ? ` · ${d.source}${d.scaled ? ` × ${d.k.toFixed(2)} (raw ${d.raw})` : ""}` : "";
    btn.title = `${d.date}: ${hasData ? shown + " fire pixels" + src : "No observation"}`;
    btn.setAttribute("aria-label", btn.title);
    btn.classList.toggle("chosen", d.date === iso(state.end));
    btn.classList.toggle("from-modis", state.sensor === "harmonized" && d.source === "MODIS");
    btn.disabled = Date.parse(d.date) < FIRST[state.sensor] || Date.parse(d.date) > LATEST;
    btn.addEventListener("click", () => setDate(Date.parse(d.date)));
    box.append(btn);
  }
}

function harmonizeDays(days, month) {
  if (state.sensor !== "harmonized") return days;
  const k = window.FireHistory?.k?.(month);
  return days.map((d) => (d.source === "MODIS" && d.count != null && k
    ? { ...d, raw: d.count, k, scaled: true, count: Math.round(d.count * k * 10) / 10 } : d));
}
let lastCalendar = null;
function redrawCalendar() {
  if (!lastCalendar) return;
  const { raw, year, month } = lastCalendar;
  const days = harmonizeDays(raw, month);
  showCalendar(days, year, month);
  state.calendarDays = { year, month, sensor: state.sensor, days };
  window.dispatchEvent(new CustomEvent("firescout:calendar"));
  const active = days.filter((d) => d.count > 0).length;
  const observed = days.filter((d) => d.count !== null && d.count !== undefined).length;
  const total = days.reduce((s, d) => s + (d.count || 0), 0);
  const peak = days.reduce((p, d) => (d.count || 0) > (p?.count || 0) ? d : p, null);
  const srcs = [...new Set(days.map((d) => d.source).filter(Boolean))].join(" + ");
  $("#calendar-note").textContent = `${active} of ${observed} observed days had fire · ${Math.round(total).toLocaleString()} fire pixels`
    + (peak?.count ? ` · busiest ${fmt(Date.parse(peak.date))}` : "")
    + (state.sensor === "harmonized" && srcs ? ` · read from ${srcs}` : "");
}
addEventListener("firescout:history", redrawCalendar);
async function loadCalendar() {
  const token = ++state.calendarToken;
  const [year, month] = calendarMonthParts();
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  state.calendarMonth = ym;
  $("#cal-title").textContent = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const empty = Array.from({ length: daysInMonth }, (_, i) => ({ date: `${ym}-${String(i + 1).padStart(2, "0")}`, count: null }));
  showCalendar(empty, year, month); lastCalendar = null;
  $("#fire-calendar").classList.toggle("loading", !!state.pin);
  state.calendarDays = null; window.dispatchEvent(new CustomEvent("firescout:calendar"));
  if (!state.pin) { $("#calendar-note").textContent = "Pick a place to see the calendar."; return; }
  $("#calendar-note").textContent = `Loading ${SENSOR_NAME[state.sensor]} daily detections…`;
  try {
    const r = await api("fire_calendar", { year, month, sensor: state.sensor, ...areaParams() });
    if (token !== state.calendarToken) return;
    lastCalendar = { raw: r.days, year, month };
    redrawCalendar();
  } catch (err) { if (token === state.calendarToken) $("#calendar-note").textContent = err.message; }
  finally { if (token === state.calendarToken) $("#fire-calendar").classList.remove("loading"); }
}
function moveCalendar(delta) {
  const [year, month] = calendarMonthParts();
  const target = Date.UTC(year, month - 1 + delta, Math.min(new Date(state.end).getUTCDate(), 28));
  if (target < MIN_DATE || target > LATEST) return;
  setDate(target);
}
$("#cal-prev").addEventListener("click", () => moveCalendar(-1));
$("#cal-next").addEventListener("click", () => moveCalendar(1));

const PALETTES = {
  warm: ["#1d2230", "#4a1f26", "#8c2430", "#e0443a", "#ff9a5c"],
  cvd:  ["#1d2230", "#3B528B", "#21918C", "#5EC962", "#FDE725"],
  mono: ["#1d2230", "#4a4f5c", "#7a7f8c", "#b0b4bd", "#f0f1f4"],
};
const PRINT_PALETTES = {
  warm: ["#F3EFEE", "#F6C9C2", "#EE8A80", "#D8333A", "#8E1022"],
  cvd:  ["#F2F2EE", "#B5DE2B", "#35B779", "#31688E", "#440154"],
  mono: ["#F4F4F4", "#C9C9C9", "#969696", "#5E5E5E", "#1F1F1F"],
};
window.firescoutPrintPalette = () => PRINT_PALETTES[document.documentElement.dataset.palette || "warm"];
window.firescoutPalette = () => PALETTES[document.documentElement.dataset.palette || "warm"];
function setPalette(name) {
  if (!PALETTES[name]) name = "warm";
  PALETTES[name].forEach((c, i) => document.documentElement.style.setProperty(`--h${i}`, c));
  document.documentElement.dataset.palette = name;
  $("#palette").value = name;
  try { localStorage.setItem("firescout.palette", name); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent("firescout:palette"));
}
$("#palette").addEventListener("change", (e) => setPalette(e.target.value));
setPalette((() => { try { return localStorage.getItem("firescout.palette"); } catch { return null; } })() || "warm");

// ---------------------------------------------------------------- boot
async function boot() {
  selectSensor(state.sensor);

  try {
    const meta = await api("meta");
    for (const [name, m] of Object.entries(meta)) {
      const row = $(`.layer[data-layer="${name}"]`);
      if (!row || row.dataset.legendSet) continue;
      $(".bar", row).style.background = `linear-gradient(90deg, ${m.palette.join(", ")})`;
      $(".lo", row).textContent = m.legend_min; $(".hi", row).textContent = m.legend_max;
    }
  } catch { /* legends are cosmetic */ }

  await new Promise((r) => (map.loaded() ? r() : map.once("load", r)));
  map.addSource("area", { type: "geojson", data: state.pin ? areaShape() : { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#ff7a45", "fill-opacity": 0.07 } });
  map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#ffb27a", "line-opacity": .9, "line-width": 1.5, "line-dasharray": [2, 2] } });
  spin();

  const h = await api("health").catch((e) => ({ ok: false, error: e.message }));
  if (!h.ok) {
    const s = $("#setup"); s.hidden = false;
    s.textContent = `Earth Engine is not connected yet. ${h.error}`;
    return;
  }
  refreshAll();
}
boot();
