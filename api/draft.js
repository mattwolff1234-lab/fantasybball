// Live draft board: reads the draft from ESPN using the league's login, which is kept in
// Vercel's settings (ESPN_S2, SWID, LEAGUE_ID) and never in the repo. The browser only gets
// first names, team names and picks.
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
  const year = /^20\d\d$/.test(req.query.year || "") ? Number(req.query.year) : SEASON;
  try {
    const [league, known] = await Promise.all([espn(year, ["mDraftDetail", "mTeam", "mSettings"]), players(year)]);
    const draft = league.draftDetail, settings = league.settings.draftSettings;

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
      inProgress: !!draft.inProgress,
      drafted: !!draft.drafted,
      order,
      picks: draft.picks.map(p => ({
        n: p.overallPickNumber, round: p.roundId, slot: p.roundPickNumber, teamId: p.teamId,
        player: p.playerId > 0 ? known.get(p.playerId) || { id: p.playerId, name: "Player " + p.playerId, pos: "", team: "" } : null,
      })),
    });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}
