"use strict";

// Side-panel tabs and the story popup.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const tabs = $$(".rail-tabs [role=tab]"), panels = $$(".tab-panel");
  function showTab(name) {
    if (!panels.some((p) => p.dataset.panel === name)) name = "explore";
    tabs.forEach((t) => { const on = t.dataset.tab === name; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
    panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
    $("#rail .panel-body").scrollTop = 0;
    try { localStorage.setItem("firescout.tab", name); } catch { /* storage blocked */ }
    window.dispatchEvent(new CustomEvent("firescout:tab", { detail: name }));
  }
  tabs.forEach((t) => t.addEventListener("click", () => {
    showTab(t.dataset.tab);
    const rail = $("#rail");
    if (rail.classList.contains("collapsed")) rail.querySelector(".panel-toggle").click();
  }));
  $(".rail-tabs").addEventListener("keydown", (e) => {
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (n === null) return;
    const t = tabs[(n + tabs.length) % tabs.length]; showTab(t.dataset.tab); t.focus();
  });
  function revealInTabs(el) {
    const p = el?.closest?.(".tab-panel");
    if (p && p.hidden) showTab(p.dataset.panel);
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
