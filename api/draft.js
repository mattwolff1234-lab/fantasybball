// Live draft board: reads the draft from ESPN using the league's login, which is kept in
// Vercel's settings (ESPN_S2, SWID, LEAGUE_ID) and never in the repo. The browser only gets
// first names, team names and picks.
import { list, put } from "@vercel/blob";
import { createHash } from "node:crypto";

const SEASON = 2027; // ESPN names a season by the year it ends in
const POS = { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" };
const NBA = ["", "ATL", "BOS", "NOP", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MIA", "MIL", "MIN", "BKN", "NYK", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "OKC", "UTA", "WAS", "TOR", "MEM", "CHA"];
// ESPN account names that belong to someone else, and the short names the site uses.
const SAME_PERSON = { "harc bark": "Ben Einzig", "umar ahmad": "Mack Harris", "team 10": "Dean Bowie", "anthony grbic": "John Grbic" };
const SHORT = { "Matt Wolff": "Matt W", "Matthew Glickman": "Matt G", "Sam Resnick": "Sammy" };

const BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/";

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

async function espn(year, views) {
  const { ESPN_S2, SWID, LEAGUE_ID } = process.env;
  const r = await fetch(`${BASE}${year}/segments/0/leagues/${LEAGUE_ID}?` + views.map(v => "view=" + v).join("&"), { headers: { Cookie: `espn_s2=${ESPN_S2}; SWID=${SWID}` } });
  if (!r.ok) throw new Error("ESPN answered " + r.status);
  return r.json();
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

function ownerName(member) {
  if (!member) return "";
  const full = `${member.firstName || ""} ${member.lastName || ""}`.trim();
  const real = SAME_PERSON[full.toLowerCase()] || full;
  return SHORT[real] || real.split(" ")[0];
}

export default async function handler(req, res) {
  if (!process.env.ESPN_S2 || !process.env.SWID || !process.env.LEAGUE_ID) {
    return res.status(503).json({ error: "The board is not connected to ESPN yet." });
  }
  if (req.method === "POST") return saveLive(req, res);
  const year = /^20\d\d$/.test(req.query.year || "") ? Number(req.query.year) : SEASON;
  try {
    const [league, known, live] = await Promise.all([espn(year, ["mDraftDetail", "mTeam", "mSettings"]), players(year), year === SEASON ? readLive().catch(() => null) : null]);
    const draft = league.draftDetail, settings = league.settings.draftSettings;
    // Use the watcher's picks only for this season's draft, and only until ESPN's own list catches up.
    const watched = live && live.year === year && !draft.drafted && Date.now() - live.at < 6 * 3600000 ? live : null;
    const fresh = watched && Date.now() - watched.at < 20000;
    const playerId = p => p.playerId > 0 ? p.playerId : (watched && watched.picks[p.overallPickNumber - 1]) || 0;

    const members = Object.fromEntries((league.members || []).map(m => [m.id, m]));
    const teams = Object.fromEntries(league.teams.map(t => [t.id, {
      id: t.id,
      owner: ownerName(members[(t.owners || [])[0]]) || t.abbrev,
      team: (t.name || `${t.location || ""} ${t.nickname || ""}`).replace(/\s+/g, " ").trim(),
    }]));
    const firstRound = draft.picks.filter(p => p.roundId === 1).sort((a, b) => a.roundPickNumber - b.roundPickNumber).map(p => p.teamId);
    const order = (settings.pickOrder && settings.pickOrder.length ? settings.pickOrder : firstRound).map(id => teams[id]);

    // One second of sharing between viewers, so a room full of phones is still one request to ESPN.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1, stale-while-revalidate=1");
    res.status(200).json({
      year,
      starts: settings.date || null,
      seconds: settings.timePerSelection || 0,
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
