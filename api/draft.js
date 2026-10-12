// Live draft board: reads the draft from ESPN. The browser only gets first names, team names
// and picks.
import { list, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { SEASON, POS, NBA, BASE, connected, espn, teamsOf } from "../lib/espn.js";

// ESPN's list of every NBA player (name, position, team) for a season. Kept in memory while
// the server is warm, so it is downloaded once rather than on every refresh.
const playerLists = new Map();

async function players(year) {
  if (!playerLists.has(year)) {
    const r = await fetch(`${BASE}${year}/players?view=players_wl&scoringPeriodId=0`, { headers: { "x-fantasy-filter": JSON.stringify({ filterActive: { value: true } }) } });
    if (!r.ok) throw new Error("ESPN answered " + r.status);
    playerLists.set(year, new Map((await r.json()).map(p => [p.id, { id: p.id, name: p.fullName, pos: POS[p.defaultPositionId] || "", team: NBA[p.proTeamId] || "" }])));
  }
  return playerLists.get(year);
}

// ESPN's data feed does not show picks until the draft is over. During the draft, a watcher
// running inside ESPN's own draft room sends the picks and the real pick clock here, and the
// board lays them over ESPN's empty list. The watcher proves itself with a key; only the
// key's SHA-256 is kept in the repo.
const WATCH_HASH = "00a2e6570b8b9459df95c1e58098af2ef12ee799438ca04157ccf08fc901ada7";
const LIVE = "draft/live.json";

async function readLive() {
  const { blobs } = await list({ prefix: LIVE, limit: 1 });
  if (!blobs[0]) return null;
  const r = await fetch(blobs[0].url + "?v=" + new Date(blobs[0].uploadedAt).getTime(), { cache: "no-store" });
  return r.ok ? r.json() : null;
}

async function saveLive(req, res) {
  let body = req.body;
  if (typeof body === "string") try { body = JSON.parse(body); } catch (e) { body = {}; }
  body = body || {};
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (createHash("sha256").update(String(body.key || "")).digest("hex") !== WATCH_HASH) return res.status(403).json({ error: "Wrong key." });
  const picks = (Array.isArray(body.picks) ? body.picks : []).slice(0, 400).map(id => Number(id) || 0);
  await put(LIVE, JSON.stringify({ year: SEASON, picks, ends: Date.now() + (Number(body.timeLeft) || 0), at: Date.now() }), {
    access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60,
  });
  res.status(200).json({ ok: true, picks: picks.filter(Boolean).length });
}

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The board is not connected to ESPN yet." });
  if (req.method === "POST") return saveLive(req, res);
  const year = /^20\d\d$/.test(req.query.year || "") ? Number(req.query.year) : SEASON;
  try {
    const [league, known, live] = await Promise.all([espn(year, ["mDraftDetail", "mTeam", "mSettings"]), players(year), year === SEASON ? readLive().catch(() => null) : null]);
    const draft = league.draftDetail, settings = league.settings.draftSettings;
    // Use the watcher's picks only for this season's draft, and only until ESPN's own list catches up.
    const watched = live && live.year === year && !draft.drafted && Date.now() - live.at < 6 * 3600000 ? live : null;
    const fresh = watched && Date.now() - watched.at < 45000;
    const playerId = p => p.playerId > 0 ? p.playerId : (watched && watched.picks[p.overallPickNumber - 1]) || 0;

    const teams = teamsOf(league);
    const firstRound = draft.picks.filter(p => p.roundId === 1).sort((a, b) => a.roundPickNumber - b.roundPickNumber).map(p => p.teamId);
    const order = (settings.pickOrder && settings.pickOrder.length ? settings.pickOrder : firstRound).map(id => teams[id]);

    // One second of sharing between viewers, so a room full of phones is still one request to ESPN.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1, stale-while-revalidate=1");
    res.status(200).json({
      year,
      starts: settings.date || null,
      seconds: settings.timePerSelection || 0,
      // What the season simulation needs: starting lineup size, regular-season weeks, playoff teams.
      league: {
        starters: Object.entries(league.settings.rosterSettings.lineupSlotCounts).reduce((sum, [slot, n]) => sum + (slot < 12 ? n : 0), 0),
        weeks: league.settings.scheduleSettings.matchupPeriodCount,
        playoffTeams: league.settings.scheduleSettings.playoffTeamCount,
      },
      // ESPN can leave "in progress" switched on after a draft that had already opened is pushed back.
      // With no picks made and the start time still ahead, it has not really started.
      inProgress: !!draft.inProgress && !(settings.date > Date.now() && draft.picks.every(p => playerId(p) <= 0)),
      // Milliseconds left on ESPN's real pick clock, when the watcher has reported in the last few seconds.
      clockLeft: fresh ? Math.max(0, watched.ends - Date.now()) : null,
      watching: !!fresh,
      drafted: !!draft.drafted,
      order,
      picks: draft.picks.map(p => ({
        n: p.overallPickNumber, round: p.roundId, slot: p.roundPickNumber, teamId: p.teamId,
        player: playerId(p) > 0 ? known.get(playerId(p)) || { id: playerId(p), name: "Player " + playerId(p), pos: "", team: "" } : null,
      })),
    });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}
