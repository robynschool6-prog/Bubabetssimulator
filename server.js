/**
 * OddsLab — sportsbook-style SIMULATOR backend.
 * Simulation only — no real money betting. No deposits, no withdrawals.
 *
 * Responsibilities:
 *  - Keep ODDS_API_KEY strictly server-side (.env).
 *  - Proxy The Odds API v4 and return cleaned, frontend-friendly JSON.
 *  - Light in-memory caching so you don't burn your monthly request quota.
 */

require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ODDS_API_KEY;
const REGIONS = process.env.ODDS_REGIONS || "uk";
const BASE = "https://api.the-odds-api.com/v4";

// Sports exposed in the UI -> The Odds API sport keys
const SPORTS = [
  { id: "soccer_fifa_world_cup", label: "World Cup 2026",       group: "Football" },
  { id: "basketball_nba",        label: "Basketball · NBA",     group: "Basketball" },
  { id: "tennis_atp_wimbledon",  label: "Tennis · ATP",         group: "Tennis" },
  { id: "tennis_wta_wimbledon",  label: "Tennis · WTA",         group: "Tennis" }
];

// Additional per-event markets (fetched on demand — these cost extra quota).
// Player props excluded (US bookmakers only).
const EXTRA_MARKETS = {
  Football: [
    "btts", "draw_no_bet", "double_chance",
    "team_totals", "alternate_team_totals",
    "alternate_totals", "alternate_spreads",
    "alternate_totals_corners", "alternate_spreads_corners",
    "alternate_totals_cards", "alternate_spreads_cards"
  ],
  Basketball: ["alternate_totals", "alternate_spreads", "team_totals"],
  Tennis: ["alternate_totals", "alternate_spreads"]
};

// FIFA World Cup 2026 group stage (final draw incl. March 2026 playoff winners)
const WC_GROUPS = {
  A: ["Czechia", "Mexico", "South Africa", "South Korea"],
  B: ["Bosnia and Herzegovina", "Canada", "Qatar", "Switzerland"],
  C: ["Brazil", "Haiti", "Morocco", "Scotland"],
  D: ["Australia", "Paraguay", "Türkiye", "United States"],
  E: ["Curaçao", "Ecuador", "Germany", "Ivory Coast"],
  F: ["Japan", "Netherlands", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Cape Verde", "Saudi Arabia", "Spain", "Uruguay"],
  I: ["France", "Iraq", "Norway", "Senegal"],
  J: ["Algeria", "Argentina", "Austria", "Jordan"],
  K: ["Colombia", "Congo DR", "Portugal", "Uzbekistan"],
  L: ["Croatia", "England", "Ghana", "Panama"]
};

// ---- tiny cache (5 min TTL) ------------------------------------------------
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < (hit.ttl || TTL_MS)) return hit.v;
  cache.delete(key);
  return null;
}
function cacheSet(key, v, ttl) {
  cache.set(key, { t: Date.now(), v, ttl });
}

// ---- helpers ----------------------------------------------------------------
async function fetchOddsApi(url) {
  const res = await fetch(url);
  const remaining = res.headers.get("x-requests-remaining");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Odds API responded ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return { data, remaining };
}

/** Reduce a raw Odds API event to exactly what the frontend needs. */
function cleanEvent(ev) {
  // Pick one bookmaker per market: the one with the most recent update.
  const markets = {};
  for (const bm of ev.bookmakers || []) {
    for (const m of bm.markets || []) {
      const current = markets[m.key];
      if (!current || new Date(m.last_update) > new Date(current.lastUpdate)) {
        markets[m.key] = {
          key: m.key,
          lastUpdate: m.last_update,
          outcomes: (m.outcomes || []).map((o) => ({
            name: o.name,
            description: o.description ?? null,
            price: o.price,           // decimal odds
            point: o.point ?? null    // spread / total line
          }))
        };
      }
    }
  }
  return {
    id: ev.id,
    sportKey: ev.sport_key,
    sportTitle: ev.sport_title,
    commenceTime: ev.commence_time,
    home: ev.home_team,
    away: ev.away_team,
    markets // { h2h: {...}, spreads: {...}, totals: {...} }
  };
}

// ---- middleware --------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// World Cup Hub — API-Sports widgets page. The key is injected server-side
// from the APISPORTS_KEY env var so it never lives in the repository.
const fs = require("fs");
app.get("/hub", (req, res) => {
  const key = process.env.APISPORTS_KEY;
  if (!key) {
    return res
      .status(500)
      .send(
        "<h2 style='font-family:sans-serif'>World Cup Hub not configured</h2>" +
        "<p style='font-family:sans-serif'>Add an <code>APISPORTS_KEY</code> environment variable " +
        "(free key from dashboard.api-football.com) and redeploy.</p>"
      );
  }
  const html = fs
    .readFileSync(path.join(__dirname, "hub.template.html"), "utf8")
    .replace("__APISPORTS_KEY__", key);
  res.type("html").send(html);
});

app.use("/api", (req, res, next) => {
  // Static endpoints don't need the upstream API
  if (req.path === "/sports" || req.path === "/groups") return next();
  if (!API_KEY || API_KEY === "your_api_key_here") {
    return res.status(500).json({
      error:
        "Missing ODDS_API_KEY. Copy .env.example to .env and add your key from the-odds-api.com, then restart the server."
    });
  }
  next();
});

// ---- routes -------------------------------------------------------------------

/** Sports the UI offers (curated list, no API call needed). */
app.get("/api/sports", (req, res) => {
  res.json({ sports: SPORTS });
});

/**
 * Live + upcoming events with odds for one sport.
 * GET /api/odds/:sport
 */
app.get("/api/odds/:sport", async (req, res) => {
  const sport = req.params.sport;
  if (!SPORTS.some((s) => s.id === sport)) {
    return res.status(400).json({ error: "Unknown sport key." });
  }

  const cacheKey = `odds:${sport}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const url =
    `${BASE}/sports/${encodeURIComponent(sport)}/odds` +
    `?apiKey=${API_KEY}&regions=${REGIONS}&markets=h2h,spreads,totals&oddsFormat=decimal`;

  try {
    const { data, remaining } = await fetchOddsApi(url);
    const payload = {
      sport,
      events: data.map(cleanEvent).filter((e) => Object.keys(e.markets).length > 0),
      quotaRemaining: remaining
    };
    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err.message);
    res
      .status(err.status === 401 ? 401 : 502)
      .json({ error: err.status === 401 ? "Invalid API key." : "Could not fetch odds right now." });
  }
});

/**
 * Live + recent scores for one sport (The Odds API scores endpoint).
 * Cached 60s. Costs 2 API credits per uncached call (daysFrom included).
 * GET /api/scores/:sport
 */
app.get("/api/scores/:sport", async (req, res) => {
  const sport = req.params.sport;
  if (!SPORTS.some((s) => s.id === sport)) {
    return res.status(400).json({ error: "Unknown sport key." });
  }

  const cacheKey = `scores:${sport}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const url =
    `${BASE}/sports/${encodeURIComponent(sport)}/scores` +
    `?apiKey=${API_KEY}&daysFrom=1`;

  try {
    const { data } = await fetchOddsApi(url);
    const payload = {
      sport,
      games: data.map((g) => ({
        id: g.id,
        commenceTime: g.commence_time,
        completed: g.completed,
        home: g.home_team,
        away: g.away_team,
        lastUpdate: g.last_update,
        scores: (g.scores || []).map((s) => ({ name: s.name, score: s.score }))
      }))
    };
    cacheSet(cacheKey, payload, 60 * 1000);
    res.json(payload);
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "Could not fetch scores right now." });
  }
});

/** World Cup 2026 groups (static). */
app.get("/api/groups", (req, res) => {
  res.json({ groups: WC_GROUPS });
});

/**
 * Additional markets for one event (BTTS, double chance, corners, cards, alternates…).
 * Fetched on demand; cached 5 min. Each market in the request costs 1 API credit.
 * GET /api/event-odds/:sport/:eventId
 */
app.get("/api/event-odds/:sport/:eventId", async (req, res) => {
  const { sport, eventId } = req.params;
  const sportDef = SPORTS.find((s) => s.id === sport);
  if (!sportDef) return res.status(400).json({ error: "Unknown sport key." });
  if (!/^[a-zA-Z0-9]+$/.test(eventId)) return res.status(400).json({ error: "Bad event id." });

  const markets = EXTRA_MARKETS[sportDef.group] || [];
  if (!markets.length) return res.json({ markets: {} });

  const cacheKey = `event:${sport}:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const url =
    `${BASE}/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds` +
    `?apiKey=${API_KEY}&regions=${REGIONS}&markets=${markets.join(",")}&oddsFormat=decimal`;

  try {
    const { data } = await fetchOddsApi(url);
    const payload = { markets: cleanEvent(data).markets };
    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "Could not fetch extra markets for this event." });
  }
});

app.listen(PORT, () => {
  console.log(`\nOddsLab simulator running → http://localhost:${PORT}`);
  console.log("Simulation only — no real money betting.\n");
});
