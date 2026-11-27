"use strict";

// Side-panel tabs and the story popup.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const tabs = $$(".rail-tabs [role=tab]"), panels = $$(".tab-panel");
  const TITLES = { explore: "Map", calendar: "Burn calendar", passes: "Satellite passes", saved: "Saved", export: "Export for reports" };
  const rail = $("#rail"), railToggle = rail.querySelector(".panel-toggle");
  const setRail = (open) => { if (rail.classList.contains("collapsed") === open) railToggle.click(); };
  function showTab(name) {
    if (!panels.some((p) => p.dataset.panel === name)) name = "explore";
    tabs.forEach((t) => { const on = t.dataset.tab === name; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
    panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
    $("#drawer-title").textContent = TITLES[name] || "";
    $("#rail .panel-body").scrollTop = 0;
    try { localStorage.setItem("firescout.tab", name); } catch { /* storage blocked */ }
    window.dispatchEvent(new CustomEvent("firescout:tab", { detail: name }));
  }
  // clicking a tab opens the drawer on it; clicking the open tab again closes the drawer
  tabs.forEach((t) => t.addEventListener("click", () => {
    const already = t.getAttribute("aria-selected") === "true" && !rail.classList.contains("collapsed");
    if (already) { setRail(false); return; }
    showTab(t.dataset.tab); setRail(true);
  }));
  new MutationObserver(() => document.body.classList.toggle("drawer-closed", rail.classList.contains("collapsed")))
    .observe(rail, { attributes: true, attributeFilter: ["class"] });
  $(".rail-tabs").addEventListener("keydown", (e) => {
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (n === null) return;
    const t = tabs[(n + tabs.length) % tabs.length]; showTab(t.dataset.tab); t.focus();
  });
  function revealInTabs(el) {
    const p = el?.closest?.(".tab-panel");
    if (p && p.hidden) showTab(p.dataset.panel);
    if (p) setRail(true);
  }
  addEventListener("firescout:calendar", () => $('[data-tab="calendar"]').classList.toggle("dot", !!state.calendarDays));
  showTab((() => { try { return localStorage.getItem("firescout.tab"); } catch { return null; } })() || "explore");
  window.FireTabs = { show: showTab, reveal: revealInTabs };

  // story popup
  const story = $("#story");
  let last = null;
  const open = () => { last = document.activeElement; story.hidden = false; $("#story-x").focus({ preventScroll: true }); };
  const close = () => { if (story.hidden) return; story.hidden = true; last?.focus?.({ preventScroll: true }); };
  $("#story-btn").addEventListener("click", open);
  $("#story-x").addEventListener("click", close);
  story.addEventListener("click", (e) => { if (e.target === story) close(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
