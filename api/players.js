// Player pool for the draft guide, straight from ESPN Fantasy.
// Set ESPN_LEAGUE_ID to rank by our league's scoring; a private league also needs ESPN_S2 and ESPN_SWID (browser cookies).
// Without a league id it falls back to ESPN's default player pool and the page ranks by standard 9-cat.
const BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/";
const SEASON = +(process.env.ESPN_SEASON || 2027); // ESPN names a season by the year it ends: 2026-27 is 2027
const SLOTS = { 0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C" };
const TEAMS = ["FA", "ATL", "BOS", "NOP", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MIA", "MIL",
  "MIN", "BKN", "NYK", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "OKC", "UTA", "WAS", "TOR", "MEM", "CHA"];
// ESPN stat ids we keep, by name
const STATS = { PTS: 0, BLK: 1, STL: 2, AST: 3, OREB: 4, DREB: 5, REB: 6, TO: 11, FGM: 13, FGA: 14, FTM: 15, FTA: 16,
  "3PM": 17, "3PA": 18, "FG%": 19, "FT%": 20, "3P%": 21, DD: 37, TD: 38, MIN: 40, GP: 42 };
const NAME = Object.fromEntries(Object.entries(STATS).map(([k, v]) => [v, k]));

async function espn(path, view, filter) {
  const headers = { Accept: "application/json" };
  if (filter) headers["X-Fantasy-Filter"] = JSON.stringify(filter);
  const { ESPN_S2, ESPN_SWID } = process.env;
  if (ESPN_S2 && ESPN_SWID) headers.Cookie = `espn_s2=${ESPN_S2}; SWID=${ESPN_SWID}`;
  const r = await fetch(BASE + SEASON + "/segments/0/" + path + "?view=" + view, { headers });
  if (!r.ok) throw new Error("ESPN " + r.status + " on " + view);
  return r.json();
}

// Per game line for one stat split. Projections and season totals both carry totals; averages are not always there.
function line(split) {
  const tot = split.stats || {}, avg = split.averageStats || {};
  const gp = tot[STATS.GP] || 0;
  const out = { GP: gp };
  for (const [id, key] of Object.entries(NAME)) {
    if (key === "GP") continue;
    let v = avg[id];
    if (v == null && tot[id] != null) v = key.endsWith("%") ? tot[id] : gp ? tot[id] / gp : 0;
    if (v != null) out[key] = v;
  }
  return gp ? out : null;
}

function player(e) {
  const p = e.player || e;
  const split = (src, season) => (p.stats || []).find(s => s.seasonId === season && s.statSourceId === src && s.statSplitTypeId === 0);
  const proj = split(1, SEASON), last = split(0, SEASON - 1), now = split(0, SEASON);
  return {
    id: p.id, name: p.fullName, team: TEAMS[p.proTeamId] || "FA",
    pos: (p.eligibleSlots || []).filter(s => s in SLOTS).map(s => SLOTS[s]),
    injury: p.injuryStatus && p.injuryStatus !== "ACTIVE" ? p.injuryStatus : null,
    rank: p.draftRanksByRankType?.STANDARD?.rank || null,
    adp: p.ownership?.averageDraftPosition || null,
    proj: proj && line(proj), last: last && line(last), now: now && line(now),
  };
}

function settings(s) {
  const items = s?.scoringSettings?.scoringItems || [];
  return {
    name: s?.name || null, size: s?.size || 10, type: s?.scoringSettings?.scoringType || null,
    cats: items.filter(i => NAME[i.statId]).map(i => ({ stat: NAME[i.statId], reverse: !!i.isReverseItem })),
    points: Object.fromEntries(items.filter(i => NAME[i.statId] && i.points).map(i => [NAME[i.statId], i.points])),
  };
}

export default async function handler(req, res) {
  const league = process.env.ESPN_LEAGUE_ID;
  const filter = { players: {
    filterSlotIds: { value: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: ["10" + SEASON, "00" + (SEASON - 1), "00" + SEASON] },
    limit: 400,
    sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" },
  } };
  try {
    const [set, pool] = await Promise.all([
      league ? espn("leagues/" + league, "mSettings").catch(() => null) : null,
      espn(league ? "leagues/" + league : "leaguedefaults/3", "kona_player_info", filter)
        .catch(err => league ? espn("leaguedefaults/3", "kona_player_info", filter) : Promise.reject(err)),
    ]);
    const players = (pool.players || []).map(player).filter(p => p.name && (p.proj || p.last || p.now));
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    res.status(200).json({ season: SEASON, league: set?.settings ? settings(set.settings) : null, players });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN right now. Try again in a minute." });
  }
}
