// One file per day of the season: every rostered player who scored, the lineup slot he was in,
// the slots he could have filled, and the day's waiver and trade moves. Shared by the Records
// page and the weekly recap. Finished days are saved in Blob, so ESPN is asked for each once.
import { list, put } from "@vercel/blob";
import { SEASON, BASE, espn } from "./espn.js";

export const BENCH = 12, IR = 13; // lineup slots that do not score
const folder = `days/${SEASON}/`;
const MOVES = /^(FREEAGENT|WAIVER|TRADE)/;

async function fetchDay(period) {
  const [roster, moves] = await Promise.all([
    espn(SEASON, ["mRoster"], { scoringPeriodId: period }),
    espn(SEASON, ["mTransactions2"], { scoringPeriodId: period }).catch(() => ({ transactions: [] })),
  ]);
  const teams = {}, names = {};
  for (const t of roster.teams) {
    teams[t.id] = [];
    for (const e of t.roster?.entries || []) {
      const p = e.playerPoolEntry?.player;
      if (!p) continue;
      const stats = (p.stats || []).filter(s => s.scoringPeriodId === period && s.statSourceId === 0);
      const day = stats.find(s => s.statSplitTypeId === 5) || stats[0];
      const points = day ? Math.round((day.appliedTotal || 0) * 10) / 10 : 0;
      names[p.id] = p.fullName;
      // [player id, points, lineup slot, slots he could fill, played that day]
      teams[t.id].push([p.id, points, e.lineupSlotId, (p.eligibleSlots || []).filter(s => s < BENCH), day ? 1 : 0]);
    }
  }
  const tx = (moves.transactions || []).filter(t => t.status === "EXECUTED" && MOVES.test(t.type)).map(t => ({
    type: t.type, team: t.teamId, at: t.proposedDate,
    items: (t.items || []).filter(i => i.type !== "LINEUP").map(i => ({ type: i.type, player: i.playerId, from: i.fromTeamId, to: i.toTeamId })),
  }));
  return { period, teams, names, tx };
}

let saved = null;
async function savedDays() {
  if (saved) return saved;
  const { blobs } = await list({ prefix: folder, limit: 1000 });
  const found = new Map();
  await Promise.all(blobs.map(async b => {
    const r = await fetch(b.url, { cache: "no-store" });
    if (r.ok) found.set(Number(b.pathname.match(/day-(\d+)/)[1]), await r.json());
  }));
  return saved = found;
}

// The days asked for, from Blob where saved and from ESPN otherwise. `today` is ESPN's current
// scoring period; days within a day of it can still get stat corrections, so they are not saved.
export async function loadDays(periods, today) {
  const cache = await savedDays().catch(() => new Map());
  const out = new Map(), missing = [];
  for (const p of periods) cache.has(p) ? out.set(p, cache.get(p)) : missing.push(p);
  for (let i = 0; i < missing.length; i += 6) {
    const batch = missing.slice(i, i + 6);
    const days = await Promise.all(batch.map(fetchDay));
    await Promise.all(days.map(d => {
      out.set(d.period, d);
      if (d.period > today - 2) return null;
      cache.set(d.period, d);
      return put(`${folder}day-${d.period}.json`, JSON.stringify(d), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" }).catch(() => null);
    }));
  }
  return out;
}

// The best lineup a team could have set that day, knowing the scores. Slots are filled by a small
// search over which starting spots are taken, which is instant at this roster size.
export function bestLineup(players, slotCounts) {
  const spots = [];
  for (const [slot, n] of Object.entries(slotCounts)) if (Number(slot) < BENCH) for (let i = 0; i < n; i++) spots.push(Number(slot));
  const pool = players.filter(p => p[2] !== IR && p[1] > 0);
  let best = new Map([[0, 0]]);
  for (const [, points, , eligible] of pool) {
    const next = new Map(best);
    for (const [mask, total] of best) spots.forEach((slot, i) => {
      if (mask & (1 << i) || !eligible.includes(slot)) return;
      const m = mask | (1 << i);
      if ((next.get(m) ?? -1) < total + points) next.set(m, total + points);
    });
    best = next;
  }
  return Math.max(...best.values());
}

// ESPN's NBA schedule, for the calendar date of each scoring period. Counts back from today
// when the schedule does not say.
let calendar = null;
export async function dateOf(today) {
  if (!calendar) {
    calendar = {};
    try {
      const r = await fetch(`${BASE}${SEASON}?view=proTeamSchedules_wl`);
      for (const t of (await r.json()).settings?.proTeams || []) for (const [p, games] of Object.entries(t.proGamesByScoringPeriod || {}))
        if (games[0]?.date && !calendar[p]) calendar[p] = games[0].date;
    } catch (e) { /* fall back to counting days */ }
  }
  return (period, opts = { month: "short", day: "numeric", year: "numeric" }) => {
    let d = calendar[period] ? new Date(calendar[period]) : null;
    if (!d) { d = new Date(); d.setDate(d.getDate() - (today - period)); }
    return d.toLocaleDateString("en-US", { timeZone: "America/New_York", ...opts });
  };
}

// Every NBA player's name, for players who were dropped and so are on no roster.
let everyone = null;
export async function playerNames() {
  if (!everyone) {
    const r = await fetch(`${BASE}${SEASON}/players?view=players_wl&scoringPeriodId=0`, { headers: { "x-fantasy-filter": JSON.stringify({ filterActive: { value: true } }) } });
    everyone = r.ok ? Object.fromEntries((await r.json()).map(p => [p.id, p.fullName])) : {};
  }
  return everyone;
}
