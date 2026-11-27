"use strict";

// Saved data: watched places + saved readings.
// Kept in this browser (localStorage) and on this computer (data/saved.json, through the server),
// so nothing is lost if one of the two isn't available.
(function () {
  const q = (s, r = document) => r.querySelector(s);
  const KEY = "firescout.saved", OLD_WATCH = "firescout.watch";
  const store = { places: [], readings: [] };
  const levels = {}, smoke = {};
  let serverOk = false, pushTimer = null;

  // ---------------------------------------------------------------- storage
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (d) { store.places = d.places || []; store.readings = d.readings || []; }
      else store.places = JSON.parse(localStorage.getItem(OLD_WATCH) || "[]");   // the old watchlist
    } catch { /* storage blocked */ }
  }
  function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage blocked */ } }
  const byId = (a, b) => { const m = new Map(a.map((x) => [x.id, x])); b.forEach((x) => m.set(x.id, x)); return [...m.values()]; };

  async function pull() {
    try {
      const d = await api("saved");
      serverOk = true;
      store.places = byId(d.places || [], store.places);
      store.readings = byId(d.readings || [], store.readings).sort((a, b) => (b.saved_at || "").localeCompare(a.saved_at || ""));
      saveLocal(); render();
      if ((d.places || []).length !== store.places.length || (d.readings || []).length !== store.readings.length) push();
      status();
    } catch { serverOk = false; status(); }
  }
  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        await api("saved", {}, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(store) });
        serverOk = true;
      } catch { serverOk = false; }
      status();
    }, 400);
  }
  function commit() { saveLocal(); push(); render(); }
  function status() {
    const n = store.places.length + store.readings.length;
    q("#saved-status").textContent = !n ? "" : serverOk
      ? "Saved on this computer (data/saved.json) and in this browser."
      : "Saved in this browser. Start firescout with run.py to also save to data/saved.json.";
  }

  // ---------------------------------------------------------------- render
  const fmtDate = (s) => fmt(Date.parse(s));
  const num = (v, unit = "") => v == null ? "–" : `${Math.round(v).toLocaleString()}${unit}`;
  function button(cls, text, label, fn) {
    const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = text;
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", fn); return b;
  }

  function render() {
    // watched places
    const ul = q("#watchlist"); ul.replaceChildren();
    store.places.forEach((w) => {
      const li = document.createElement("li");
      const dot = document.createElement("span"); dot.className = "dot"; dot.dataset.level = levels[w.id] || ""; dot.title = "Status for the chosen date";
      const go = button("go", "", `Go to ${w.name}`, () => goToArea({ ...w, name: w.name }));
      go.innerHTML = "<b></b><small></small>";
      go.firstChild.textContent = w.name;
      const where = w.poly ? "Drawn area" : `${w.radius} km around ${place(w.lat, w.lon)}`;
      go.lastChild.textContent = smoke[w.id] ? `${smoke[w.id]} · ${where}` : where;
      const rm = button("rm", "×", `Remove ${w.name}`, () => { store.places = store.places.filter((x) => x.id !== w.id); commit(); });
      li.append(dot, go, rm); ul.append(li);
    });
    q("#watch-empty").hidden = store.places.length > 0;
    q("#watch-check").hidden = store.places.length === 0;

    // saved readings
    const rl = q("#readings"); rl.replaceChildren();
    store.readings.forEach((r) => {
      const v = r.values || {};
      const li = document.createElement("li"); li.className = "reading";
      const dot = document.createElement("span"); dot.className = "dot"; dot.dataset.level = v.signal || "";
      const go = button("go", "", `Open ${r.name}`, () => goToArea({ ...r, name: r.name, date: r.date }));
      go.innerHTML = "<b></b><small></small><span class='stats'></span>";
      go.children[0].textContent = r.name;
      go.children[1].textContent = `${fmtDate(r.date)}${v.smoke_level ? ` · ${v.smoke_level}` : ""}`;
      go.children[2].textContent = `🔥 ${num(v.fire_pixels)} hotspots · SO₂ ${v.so2_du == null ? "–" : v.so2_du.toFixed(2)} DU · ${num(v.burned_ha, " ha")} burned`;
      const rm = button("rm", "×", `Delete ${r.name}`, () => { store.readings = store.readings.filter((x) => x.id !== r.id); commit(); });
      li.append(dot, go, rm); rl.append(li);
    });
    q("#readings-empty").hidden = store.readings.length > 0;
    q("#readings-csv").disabled = store.readings.length === 0;
    status();
    q('[data-tab="saved"]')?.classList.toggle("dot", store.readings.length + store.places.length > 0);
  }

  // ---------------------------------------------------------------- actions
  q("#watch-add").addEventListener("click", async () => {
    const s = window.firescout.snapshot();
    if (!s.pin) return;
    const name = await askName(s.place, "Who or what is here? (e.g. Home, Grandma's house, School)");
    if (!name) return;
    store.places.push({ id: String(Date.now()), name, lat: s.pin.lat, lon: s.pin.lon, radius: s.radius, poly: s.poly || null, added: new Date().toISOString() });
    commit(); toast(`Added ${name} to My people & places (under Saved).`);
  });

  q("#reading-save").addEventListener("click", async () => {
    const s = window.firescout.snapshot();
    if (!s.pin) return;
    if (s.loading || !s.ins) { toast("Wait for the numbers to finish loading, then save."); return; }
    const name = await askName(`${s.place} · ${fmt(s.end)}`, "Save this reading");
    if (!name) return;
    const i = s.ins, rep = s.reported;
    store.readings.unshift({
      id: String(Date.now()), name, saved_at: new Date().toISOString(), date: iso(s.end), sensor: "firms",
      lat: s.pin.lat, lon: s.pin.lon, radius: s.radius, poly: s.poly || null,
      values: {
        fire_pixels: i.fire_pixels, fire_count: i.fire_count, largest_fire_px: i.largest_fire_px,
        so2_du: i.so2_du, so2_baseline_du: i.so2_baseline_du, so2_ratio: i.so2_ratio, burned_ha: i.burned_ha,
        signal: i.signal, signal_reason: i.signal_reason,
        smoke_index: i.smoke_index ?? null, smoke_level: i.health?.headline ?? null,
        reported_count: rep?.count ?? null, reported_acres: rep?.total_acres ?? null,
      },
      so2_series: (s.series || []).map((r) => ({ t: r.t, v: r.v == null ? null : +r.v.toFixed(3) })),
    });
    commit(); toast(`Saved “${name}”. Find it under Saved.`);
  });

  q("#watch-check").addEventListener("click", async () => {
    const btn = q("#watch-check"), s = window.firescout.snapshot(); btn.disabled = true; btn.textContent = "Checking…";
    await Promise.all(store.places.map(async (w) => {
      try {
        const p = { start: iso(s.end - 6 * DAY), end: iso(s.end), lat: w.lat, lon: w.lon, radius_km: w.radius, include_burn: false };
        if (w.poly) p.geom = JSON.stringify(w.poly);
        const r = await api("insights", p);
        const h = r.health;
        levels[w.id] = h ? h.signal : r.signal;
        smoke[w.id] = h ? h.headline : "";
        if (h && h.rank >= 2) toast(`${w.name}: ${h.headline}. ${h.steps[0]}`);
        else if (!h && r.signal === "alert") toast(`${w.name}: ${r.signal_reason}`);
      } catch (err) { toast(`${w.name}: ${err.message}`); }
    }));
    render(); btn.disabled = false; btn.textContent = "Check smoke for everyone";
  });

  // ---------------------------------------------------------------- downloads
  const cell = (v) => { if (v === null || v === undefined) return ""; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function save(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  q("#readings-csv").addEventListener("click", () => {
    const cols = ["name", "date", "lat", "lon", "radius_km", "area", "fire_pixels", "fire_count", "largest_fire_km2", "so2_du", "so2_baseline_du", "so2_ratio",
      "burned_ha", "reported_fires", "reported_acres", "smoke_index", "smoke_level", "signal", "signal_reason", "saved_at"];
    const rows = store.readings.map((r) => { const v = r.values || {}; return {
      name: r.name, date: r.date, lat: r.lat.toFixed(4), lon: r.lon.toFixed(4), radius_km: r.poly ? "" : r.radius, area: r.poly ? "drawn polygon" : "circle",
      fire_pixels: v.fire_pixels, fire_count: v.fire_count, largest_fire_km2: v.largest_fire_px, so2_du: v.so2_du == null ? "" : v.so2_du.toFixed(3),
      so2_baseline_du: v.so2_baseline_du == null ? "" : v.so2_baseline_du.toFixed(3), so2_ratio: v.so2_ratio == null ? "" : v.so2_ratio.toFixed(2),
      burned_ha: v.burned_ha == null ? "" : Math.round(v.burned_ha), reported_fires: v.reported_count, reported_acres: v.reported_acres,
      smoke_index: v.smoke_index == null ? "" : v.smoke_index.toFixed(2), smoke_level: v.smoke_level,
      signal: v.signal, signal_reason: v.signal_reason, saved_at: r.saved_at }; });
    const text = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
    save(`firescout_saved_readings_${new Date().toISOString().slice(0, 10)}.csv`, new Blob([text], { type: "text/csv;charset=utf-8" }));
  });
  q("#saved-backup").addEventListener("click", () => {
    save(`firescout_backup_${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ app: "firescout", version: 2, ...store }, null, 1)], { type: "application/json" }));
  });
  q("#saved-import").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const okPlace = (p) => p && typeof p.id === "string" && typeof p.name === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon);
      const places = (d.places || []).filter(okPlace), readings = (d.readings || []).filter((r) => okPlace(r) && typeof r.date === "string");
      if (!places.length && !readings.length) throw new Error("no saved places or readings in that file");
      store.places = byId(store.places, places); store.readings = byId(store.readings, readings);
      commit(); toast(`Imported ${places.length} places and ${readings.length} readings.`);
    } catch (err) { toast(`Couldn't import: ${err.message}`); }
  });

  loadLocal(); render(); pull();
})();
