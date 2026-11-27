"use strict";

// Welcome: name → what it's for → which fire satellite. Remembered in this browser.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const KEY = "firescout.profile";
  const body = document.body, intro = $("#intro");

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ } };

  // floating embers behind the welcome card
  const embers = $("#embers");
  if (!reduce) for (let i = 0; i < 26; i++) {
    const e = document.createElement("i");
    e.style.left = `${Math.random() * 100}%`;
    e.style.animationDelay = `${-Math.random() * 14}s`;
    e.style.animationDuration = `${9 + Math.random() * 9}s`;
    e.style.setProperty("--s", (0.5 + Math.random() * 1.2).toFixed(2));
    e.style.setProperty("--x", `${(Math.random() * 80 - 40).toFixed(0)}px`);
    embers.append(e);
  }

  const steps = { name: $("#s-name"), why: $("#s-why"), sensor: $("#s-sensor") };
  function show(name) {
    Object.entries(steps).forEach(([k, el]) => el.classList.toggle("active", k === name));
    const focus = { name: "#w-name", why: "input[name=why]:checked, input[name=why]", sensor: "input[name=welcome-sensor]:checked" }[name];
    setTimeout(() => $(focus, steps[name])?.focus({ preventScroll: true }), reduce ? 0 : 320);
  }

  function personalize(p) {
    $("#lede").textContent = p?.name ? `Welcome back, ${p.name}. Search a place or click the globe.` : "Search a place or click the globe.";
    const want = p?.why || "";
    $$("#presets button").forEach((b, i) => b.classList.toggle("pick", want ? (b.dataset.for || "").split(" ").includes(want) : i === 0));
  }

  async function finish(p, showTour) {
    personalize(p);
    intro.classList.add("leaving");
    await sleep(reduce ? 0 : 700);
    body.classList.remove("intro-on");
    await sleep(reduce ? 0 : 400);
    intro.hidden = true;
    if (showTour) { await sleep(reduce ? 0 : 500); window.FireTour?.start(); }
  }

  const profile = load() || {};
  const skip = location.search.includes("skip");
  if (skip || profile.done) {
    intro.hidden = true; personalize(profile);
  } else {
    body.classList.add("intro-on");
    if (profile.name) $("#w-name").value = profile.name;
    show("name");
  }

  steps.name.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#w-name").value.trim();
    if (!name) { $("#w-name").focus(); steps.name.classList.remove("shake"); void steps.name.offsetWidth; steps.name.classList.add("shake"); return; }
    profile.name = name; $("#w-hello").textContent = name; show("why");
  });

  const otherWrap = $("#w-other-wrap");
  $$("input[name=why]").forEach((r) => r.addEventListener("change", () => {
    $("#w-next2").disabled = false;
    otherWrap.classList.toggle("open", r.value === "other" && r.checked);
    if (r.value === "other") setTimeout(() => $("#w-other").focus(), 200);
  }));
  steps.why.addEventListener("submit", (e) => {
    e.preventDefault();
    const pick = $("input[name=why]:checked"); if (!pick) return;
    profile.why = pick.value; profile.other = pick.value === "other" ? $("#w-other").value.trim() : "";
    show("sensor");
  });
  $("#w-back").addEventListener("click", () => show("name"));
  $("#w-back2").addEventListener("click", () => show("why"));

  if (profile.sensor) { const input = $(`input[name=welcome-sensor][value="${profile.sensor}"]`); if (input) input.checked = true; }
  steps.sensor.addEventListener("submit", (e) => {
    e.preventDefault();
    profile.sensor = $("input[name=welcome-sensor]:checked").value;
    profile.done = true; save(profile);
    window.dispatchEvent(new CustomEvent("firescout:sensor", { detail: profile.sensor }));
    finish(profile, true);
  });

  $("#help-btn").addEventListener("click", () => window.FireTour?.start());
  window.FireIntro = { reset: () => { try { localStorage.removeItem(KEY); } catch { /* */ } location.reload(); } };
})();
