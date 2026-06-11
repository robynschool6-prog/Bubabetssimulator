/* OddsLab — simulation only, no real money betting.
   All "credits" are fake. Bets are stored in localStorage only. */

(() => {
  "use strict";

  const STORAGE_KEY = "oddslab_demo_v1";
  const DEFAULT_BALANCE = 1000;

  const MARKET_LABELS = {
    h2h: "Match winner",
    spreads: "Spread / Handicap",
    totals: "Totals (Over/Under)",
    btts: "Both teams to score",
    draw_no_bet: "Draw no bet",
    double_chance: "Double chance",
    team_totals: "Team totals",
    alternate_team_totals: "Alt team totals",
    alternate_totals: "Alternate totals",
    alternate_spreads: "Alternate spreads",
    alternate_totals_corners: "Total corners",
    alternate_spreads_corners: "Handicap corners",
    alternate_totals_cards: "Total cards",
    alternate_spreads_cards: "Handicap cards"
  };
  const UPCOMING_COUNT = 5;

  // ---------- state ----------
  let state = load() || {
    balance: DEFAULT_BALANCE,
    bets: [] // placed simulated bets
  };
  let slip = []; // current selections (not persisted)
  let currentSport = null;
  let currentGroup = null; // sport group ("Football", "Basketball", "Tennis")
  let viewMode = "upcoming"; // 'upcoming' | 'all' | 'groups'
  let eventsCache = [];
  let wcGroups = null;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    balance: $("balanceValue"),
    balancePill: $("balancePill"),
    reset: $("resetBtn"),
    tabs: $("sportTabs"),
    status: $("boardStatus"),
    events: $("events"),
    slipItems: $("slipItems"),
    slipFooter: $("slipFooter"),
    slipEmpty: $("slipEmpty"),
    slipCount: $("slipCount"),
    stake: $("stakeInput"),
    totalOdds: $("totalOdds"),
    potentialReturn: $("potentialReturn"),
    placeBet: $("placeBetBtn"),
    clearSlip: $("clearSlipBtn"),
    historyItems: $("historyItems"),
    historyEmpty: $("historyEmpty"),
    historyCount: $("historyCount")
  };

  const fmt = (n) =>
    Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- balance ----------
  function renderBalance() {
    els.balance.textContent = fmt(state.balance);
  }

  els.balancePill.addEventListener("click", () => {
    const v = prompt(
      "Set your fake demo balance (credits, no real value):",
      String(state.balance)
    );
    if (v === null) return;
    const n = parseFloat(v);
    if (!isFinite(n) || n < 0) return toast("Enter a valid non-negative number.");
    state.balance = Math.round(n * 100) / 100;
    save();
    renderBalance();
    toast("Demo balance updated.");
  });

  els.reset.addEventListener("click", () => {
    if (!confirm("Reset demo account? Balance returns to 1,000 credits and history is cleared.")) return;
    state = { balance: DEFAULT_BALANCE, bets: [] };
    slip = [];
    save();
    renderAll();
    toast("Demo account reset.");
  });

  // ---------- sports + events ----------
  async function loadSports() {
    const res = await fetch("/api/sports");
    const data = await res.json();
    els.tabs.innerHTML = "";
    data.sports.forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "sport-tab";
      b.textContent = s.label;
      b.addEventListener("click", () => selectSport(s, b));
      els.tabs.appendChild(b);
      if (i === 0) selectSport(s, b);
    });
  }

  async function selectSport(sportDef, btn) {
    currentSport = sportDef.id;
    currentGroup = sportDef.group;
    document.querySelectorAll(".sport-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    // Groups tab only makes sense for the World Cup
    const isWC = sportDef.id === "soccer_fifa_world_cup";
    $("groupsTab").style.display = isWC ? "" : "none";
    if (!isWC && viewMode === "groups") setView("upcoming");

    els.status.textContent = "Loading odds…";
    els.events.innerHTML = "";
    try {
      const res = await fetch(`/api/odds/${encodeURIComponent(sportDef.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load odds.");
      eventsCache = data.events.sort(
        (a, b) => new Date(a.commenceTime) - new Date(b.commenceTime)
      );
      renderBoard();
    } catch (err) {
      els.status.innerHTML = `<span class="error">${err.message}</span>`;
    }
  }

  // ---------- view tabs ----------
  function setView(mode) {
    viewMode = mode;
    document.querySelectorAll(".view-tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.view === mode)
    );
    renderBoard();
  }
  document.querySelectorAll(".view-tab").forEach((t) =>
    t.addEventListener("click", () => setView(t.dataset.view))
  );

  function renderBoard() {
    const groupsView = $("groupsView");
    if (viewMode === "groups") {
      els.events.innerHTML = "";
      els.status.textContent = "FIFA World Cup 2026 — group stage";
      groupsView.hidden = false;
      renderGroups();
      return;
    }
    groupsView.hidden = true;
    const list =
      viewMode === "upcoming" ? eventsCache.slice(0, UPCOMING_COUNT) : eventsCache;
    els.status.textContent = eventsCache.length
      ? viewMode === "upcoming"
        ? `Next ${list.length} of ${eventsCache.length} matches`
        : `${eventsCache.length} match${eventsCache.length === 1 ? "" : "es"}`
      : "No upcoming events with odds for this sport right now.";
    renderEvents(list);
  }

  // ---------- groups (World Cup) ----------
  async function renderGroups() {
    const view = $("groupsView");
    if (!wcGroups) {
      view.innerHTML = `<div class="empty">Loading groups…</div>`;
      try {
        const res = await fetch("/api/groups");
        wcGroups = (await res.json()).groups;
      } catch {
        view.innerHTML = `<div class="empty">Could not load groups.</div>`;
        return;
      }
    }
    view.innerHTML = "";
    for (const [letter, teams] of Object.entries(wcGroups)) {
      const card = document.createElement("div");
      card.className = "group-card";
      card.innerHTML =
        `<div class="group-letter">Group ${letter}</div>` +
        teams.map((t) => `<div class="group-team">${esc(t)}</div>`).join("");
      view.appendChild(card);
    }
  }

  function renderEvents(list) {
    els.events.innerHTML = "";
    for (const ev of list) {
      const card = document.createElement("div");
      card.className = "event-card";

      const start = new Date(ev.commenceTime);
      const live = start <= new Date();
      const head = document.createElement("div");
      head.className = "event-head";
      head.innerHTML = `
        <div class="event-teams">${esc(ev.home)} <span style="color:var(--muted)">v</span> ${esc(ev.away)}</div>
        <div class="event-time ${live ? "live" : ""}">${
          live ? "● In play" : start.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        }</div>`;
      card.appendChild(head);

      for (const key of ["h2h", "spreads", "totals"]) {
        const m = ev.markets[key];
        if (!m) continue;
        const wrap = document.createElement("div");
        wrap.className = "market";
        wrap.innerHTML = `<div class="market-label">${MARKET_LABELS[key]}</div>`;
        const row = document.createElement("div");
        row.className = "market-row";
        for (const o of m.outcomes) {
          row.appendChild(oddsTile(ev, key, o));
        }
        wrap.appendChild(row);
        card.appendChild(wrap);
      }

      // expandable extra markets (BTTS, double chance, corners, cards, alternates…)
      const extraWrap = document.createElement("div");
      extraWrap.className = "extra-markets";
      const moreBtn = document.createElement("button");
      moreBtn.className = "btn ghost small more-btn";
      moreBtn.textContent = "More markets ▾";
      moreBtn.addEventListener("click", () => toggleExtraMarkets(ev, moreBtn, extraWrap));
      card.appendChild(moreBtn);
      card.appendChild(extraWrap);

      els.events.appendChild(card);
    }
    syncTileSelection();
  }

  async function toggleExtraMarkets(ev, btn, container) {
    if (container.dataset.open === "1") {
      container.dataset.open = "0";
      container.innerHTML = "";
      btn.textContent = "More markets ▾";
      return;
    }
    container.dataset.open = "1";
    btn.textContent = "Hide markets ▴";
    container.innerHTML = `<div class="empty">Loading markets…</div>`;
    try {
      const res = await fetch(
        `/api/event-odds/${encodeURIComponent(currentSport)}/${encodeURIComponent(ev.id)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load markets.");
      container.innerHTML = "";
      const keys = Object.keys(data.markets);
      if (!keys.length) {
        container.innerHTML = `<div class="empty">No additional markets posted for this match yet.</div>`;
        return;
      }
      for (const key of keys) {
        const m = data.markets[key];
        const wrap = document.createElement("div");
        wrap.className = "market";
        wrap.innerHTML = `<div class="market-label">${MARKET_LABELS[key] || prettify(key)}</div>`;
        const row = document.createElement("div");
        row.className = "market-row";
        const outcomes = [...m.outcomes].sort(
          (a, b) => (a.point ?? 0) - (b.point ?? 0) || a.name.localeCompare(b.name)
        );
        for (const o of outcomes) row.appendChild(oddsTile(ev, key, o));
        wrap.appendChild(row);
        container.appendChild(wrap);
      }
      syncTileSelection();
    } catch (err) {
      container.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function prettify(key) {
    return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }

  function outcomeLabel(key, o) {
    const base = o.description ? `${o.description} · ${o.name}` : o.name;
    if (o.point == null) return base;
    if (key.includes("totals") || /^(over|under)/i.test(o.name)) return `${base} ${o.point}`;
    return `${base} ${o.point > 0 ? "+" : ""}${o.point}`;
  }

  function selectionId(ev, key, o) {
    return `${ev.id}|${key}|${o.name}|${o.description ?? ""}|${o.point ?? ""}`;
  }

  function oddsTile(ev, key, o) {
    const b = document.createElement("button");
    b.className = "odds-tile";
    b.dataset.sel = selectionId(ev, key, o);
    b.innerHTML = `<span class="o-name">${esc(outcomeLabel(key, o))}</span>
                   <span class="o-price">${fmt(o.price)}</span>`;
    b.addEventListener("click", () => toggleSelection(ev, key, o));
    return b;
  }

  // ---------- betslip ----------
  function toggleSelection(ev, key, o) {
    const id = selectionId(ev, key, o);
    const idx = slip.findIndex((s) => s.id === id);
    if (idx >= 0) {
      slip.splice(idx, 1);
    } else {
      // one selection per market per event (acca-friendly)
      slip = slip.filter((s) => !(s.eventId === ev.id && s.market === key));
      slip.push({
        id,
        eventId: ev.id,
        event: `${ev.home} v ${ev.away}`,
        market: key,
        marketLabel: MARKET_LABELS[key] || prettify(key),
        pick: outcomeLabel(key, o),
        odds: o.price
      });
    }
    renderSlip();
    syncTileSelection();
  }

  function syncTileSelection() {
    const ids = new Set(slip.map((s) => s.id));
    document.querySelectorAll(".odds-tile").forEach((t) => {
      t.classList.toggle("selected", ids.has(t.dataset.sel));
    });
  }

  function totalOdds() {
    return slip.reduce((acc, s) => acc * s.odds, 1);
  }

  function renderSlip() {
    els.slipCount.textContent = slip.length;
    els.slipItems.innerHTML = "";
    const has = slip.length > 0;
    els.slipFooter.classList.toggle("hidden", !has);
    els.slipEmpty.classList.toggle("hidden", has);

    for (const s of slip) {
      const d = document.createElement("div");
      d.className = "slip-item";
      d.innerHTML = `
        <div class="s-pick">${esc(s.pick)}</div>
        <div class="s-meta">${esc(s.event)} · ${s.marketLabel}</div>
        <span class="s-odds">${fmt(s.odds)}</span>
        <button class="s-remove" aria-label="Remove selection">✕</button>`;
      d.querySelector(".s-remove").addEventListener("click", () => {
        slip = slip.filter((x) => x.id !== s.id);
        renderSlip();
        syncTileSelection();
      });
      els.slipItems.appendChild(d);
    }
    updateTotals();
  }

  function updateTotals() {
    const stake = parseFloat(els.stake.value) || 0;
    const odds = slip.length ? totalOdds() : 0;
    els.totalOdds.textContent = slip.length ? fmt(odds) : "—";
    els.potentialReturn.textContent =
      slip.length && stake > 0 ? `${fmt(stake * odds)} credits` : "—";
    els.placeBet.disabled = !(slip.length && stake > 0 && stake <= state.balance);
    els.placeBet.textContent =
      stake > state.balance ? "Stake exceeds demo balance" : "Place simulated bet";
  }

  els.stake.addEventListener("input", updateTotals);
  els.clearSlip.addEventListener("click", () => {
    slip = [];
    renderSlip();
    syncTileSelection();
  });

  els.placeBet.addEventListener("click", () => {
    const stake = parseFloat(els.stake.value);
    if (!slip.length || !isFinite(stake) || stake <= 0) return;
    if (stake > state.balance) return toast("Stake exceeds your demo balance.");

    state.balance = Math.round((state.balance - stake) * 100) / 100;
    state.bets.unshift({
      id: Date.now(),
      placedAt: new Date().toISOString(),
      type: slip.length === 1 ? "Single" : `${slip.length}-leg acca`,
      stake,
      totalOdds: totalOdds(),
      potentialReturn: stake * totalOdds(),
      legs: slip.map(({ event, marketLabel, pick, odds }) => ({ event, marketLabel, pick, odds }))
    });
    save();

    slip = [];
    els.stake.value = "";
    renderAll();
    syncTileSelection();
    toast("Simulated bet placed — no real money involved.");
  });

  // ---------- history ----------
  function renderHistory() {
    els.historyCount.textContent = state.bets.length;
    els.historyItems.innerHTML = "";
    els.historyEmpty.classList.toggle("hidden", state.bets.length > 0);

    for (const b of state.bets) {
      const d = document.createElement("div");
      d.className = "history-bet";
      const legs = b.legs
        .map((l) => `<div class="h-leg">${esc(l.pick)} <span>· ${esc(l.event)} · ${fmt(l.odds)}</span></div>`)
        .join("");
      d.innerHTML = `
        <div class="h-head">
          <span class="h-tag">${b.type} · simulated</span>
          <span>${new Date(b.placedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        ${legs}
        <div class="h-line"><span>Stake ${fmt(b.stake)} @ ${fmt(b.totalOdds)}</span>
        <strong>Returns ${fmt(b.potentialReturn)}</strong></div>`;
      els.historyItems.appendChild(d);
    }
  }

  // ---------- panel tabs ----------
  document.querySelectorAll(".slip-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".slip-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`panel-${tab.dataset.panel}`).classList.add("active");
    });
  });

  // ---------- util ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function renderAll() {
    renderBalance();
    renderSlip();
    renderHistory();
  }

  // ---------- init ----------
  renderAll();
  loadSports().catch(() => {
    els.status.innerHTML = `<span class="error">Could not reach the server. Is it running?</span>`;
  });
})();
