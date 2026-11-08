// Data for the trade finder: every rostered player and the best free agents, each with this
// season's average, last season's, ESPN's preseason projection, injury news and a
// rest-of-season value (lib/value.js). The page does the trade search itself.
import { SEASON, POS, NBA, BASE, connected, espn, teamsOf } from "../lib/espn.js";
import { injuryOf, boostOf, valueOf, COVERED } from "../lib/value.js";

const IR = 13, BENCH = 12;
const SPLITS = [`00${SEASON}`, `00${SEASON - 1}`, `10${SEASON}`];
const INJURY = { OUT: "Out", DAY_TO_DAY: "Day to day", SUSPENSION: "Suspended", INJURY_RESERVE: "Injured reserve" };
const FREE_AGENTS = 40;
const r1 = n => Math.round(n * 10) / 10;

const filter = players => ({ "x-fantasy-filter": JSON.stringify({ players: { ...players, filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: SPLITS } } }) });

// One season split as { ppg, gp, min }, scored with the league's own scoring.
function split(player, id, scoring) {
  const s = (player.stats || []).find(s => s.id === id);
  const a = s?.averageStats, gp = a?.[42] || 0;
  if (!gp) return null;
  const ppg = s.appliedAverage || (s.appliedTotal ? s.appliedTotal / gp : 0) || scoring.reduce((t, i) => t + i.points * (a[i.statId] || 0), 0);
  return { ppg: r1(ppg), gp, min: r1(a[40] || 0) };
}

// Rotowire blurbs from ESPN, newest first. Kept for half an hour while the server is warm.
const newsCache = new Map();
async function news(id) {
  const hit = newsCache.get(id);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.items;
  try {
    const r = await fetch(`https://site.api.espn.com/apis/fantasy/v2/games/fba/news/players?limit=15&playerId=${id}`);
    const items = r.ok ? ((await r.json()).feed || []).filter(f => f.type === "Rotowire").map(f => ({ at: Date.parse(f.published), headline: f.headline || "", story: f.story || "" })) : [];
    newsCache.set(id, { at: Date.now(), items });
    return items;
  } catch (e) { return []; }
}
async function newsFor(ids) {
  const out = new Map(), list = [...new Set(ids)];
  for (let i = 0; i < list.length; i += 25) await Promise.all(list.slice(i, i + 25).map(async id => out.set(id, await news(id))));
  return out;
}

export async function build({ league, pool, schedule }) {
  const names = teamsOf(league);
  const today = league.scoringPeriodId || league.status?.latestScoringPeriod || 1;
  const scoring = league.settings?.scoringSettings?.scoringItems || [];
  const slots = league.settings?.rosterSettings?.lineupSlotCounts || {};
  const starters = Object.entries(slots).reduce((t, [s, n]) => t + (Number(s) < BENCH ? n : 0), 0);
  const size = Object.entries(slots).reduce((t, [s, n]) => t + (Number(s) !== IR ? n : 0), 0);
  // The fantasy season ends with the last scoring period of the last matchup.
  const periods = Object.values(league.settings?.scheduleSettings?.matchupPeriods || {}).flat();
  const end = periods.length ? Math.max(...periods) : 999;

  // Each NBA team's games: how many it has played and which days it plays from today on.
  const days = {}, played = {};
  for (const t of schedule.settings?.proTeams || []) {
    const all = Object.keys(t.proGamesByScoringPeriod || {}).map(Number);
    days[t.id] = all.filter(p => p >= today && p <= end).sort((a, b) => a - b);
    played[t.id] = all.filter(p => p < today).length;
  }

  // Who is on which team, and who sits in an IR slot.
  const owner = {}, inIR = new Set();
  for (const t of league.teams) for (const e of t.roster?.entries || []) {
    const id = e.playerId ?? e.playerPoolEntry?.player?.id;
    owner[id] = t.id;
    if (e.lineupSlotId === IR) inIR.add(id);
  }

  const all = pool.map(e => {
    const p = e.player;
    return {
      id: p.id, name: p.fullName, pos: POS[p.defaultPositionId] || "", pro: p.proTeamId, team: NBA[p.proTeamId] || "FA",
      owner: owner[p.id] || 0, status: p.injuryStatus || "ACTIVE",
      cur: split(p, SPLITS[0], scoring), last: split(p, SPLITS[1], scoring), proj: split(p, SPLITS[2], scoring),
    };
  }).filter(p => p.owner || p.cur || p.last || p.proj);

  // Players who matter on each NBA team, for "who is he filling in for".
  const mates = {};
  for (const p of all) if (Math.max(p.cur?.min || 0, p.last?.min || 0) >= 20) (mates[p.pro] ||= []).push(p);

  // A first pass without news picks the free agents worth reading about.
  const quick = p => valueOf(p, { left: days[p.pro]?.length || 0, played: played[p.pro] || 0 });
  for (const p of all) p.quick = quick(p);
  const free = all.filter(p => !p.owner && p.status !== "OUT").sort((a, b) => b.quick.ros - a.quick.ros).slice(0, FREE_AGENTS);
  // A typical pickup: the average of the best ten free agents.
  const repl = r1(free.slice(0, 10).reduce((t, p) => t + p.quick.ppg, 0) / Math.max(1, Math.min(10, free.length)));
  const used = [...all.filter(p => p.owner), ...free];

  const hurt = p => p.status === "OUT" || p.status === "DAY_TO_DAY";
  const jumped = p => p.cur && (!p.last || p.last.gp < 15 || p.cur.min - p.last.min >= 3);
  const want = new Set();
  for (const p of used) {
    if (hurt(p) || jumped(p)) want.add(p.id);
    if (jumped(p)) for (const m of mates[p.pro] || []) if (hurt(m) && m.id !== p.id) want.add(m.id);
  }
  const items = await newsFor([...want]);
  for (const p of all) p.out = items.has(p.id) ? injuryOf(items.get(p.id), p.status) : hurt(p) ? injuryOf([], p.status) : null;

  const players = used.map(p => {
    const teammates = (mates[p.pro] || []).filter(m => m.id !== p.id).map(m => ({ name: m.name, out: m.status === "OUT" ? m.out : null, missed: Math.max(0, (played[m.pro] || 0) - (m.cur?.gp || 0)) }));
    const injured = teammates.filter(m => m.out);
    const boost = jumped(p) && items.has(p.id) ? boostOf(items.get(p.id), teammates) : null;
    const v = valueOf(p, { left: days[p.pro]?.length || 0, played: played[p.pro] || 0, out: p.out, boost, injured, noNews: !items.get(p.id)?.length, repl });
    const latest = items.get(p.id)?.[0];
    return {
      id: p.id, name: p.name, pos: p.pos, team: p.team, pro: p.pro, owner: p.owner, ir: inIR.has(p.id),
      injury: INJURY[p.status] || "", cur: p.cur, last: p.last, proj: p.proj?.ppg ?? null,
      ...v, left: days[p.pro]?.length || 0,
      news: latest ? { at: latest.at, text: latest.headline } : null,
    };
  });

  return {
    year: SEASON, today, end, starters, size, irSlots: slots[IR] || 0, repl, covered: COVERED,
    weeksLeft: Math.max(1, r1((end - today + 1) / 7)),
    teams: Object.values(names),
    days: Object.fromEntries(Object.entries(days).map(([id, d]) => [id, d.map(p => p - today)])),
    players,
  };
}

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The site is not connected to ESPN yet." });
  try {
    const [league, schedule, top] = await Promise.all([
      espn(SEASON, ["mTeam", "mRoster", "mSettings"]),
      fetch(`${BASE}${SEASON}?view=proTeamSchedules_wl`).then(r => r.json()),
      espn(SEASON, ["kona_player_info"], {}, filter({ limit: 450, sortPercOwned: { sortPriority: 1, sortAsc: false } })),
    ]);
    const pool = top.players || [];
    // Rostered players outside the most-owned 450 (deep stashes).
    const have = new Set(pool.map(e => e.player.id));
    const missing = league.teams.flatMap(t => (t.roster?.entries || []).map(e => e.playerId ?? e.playerPoolEntry?.player?.id)).filter(id => !have.has(id));
    if (missing.length) pool.push(...((await espn(SEASON, ["kona_player_info"], {}, filter({ filterIds: { value: missing } }))).players || []));
    const data = await build({ league, pool, schedule });
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=900, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}
