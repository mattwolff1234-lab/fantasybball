// This season's entries for the Records page: every player's game on every day, and every
// finished matchup, read from ESPN. The page merges these into the all-time lists, which come
// from earlier seasons (public/records-data.js).
import { list, put } from "@vercel/blob";
import { SEASON, connected, espn, teamsOf } from "../lib/espn.js";

const BENCH = 12, IR = 13; // ESPN lineup slots that do not score
const label = `${SEASON - 1}-${String(SEASON).slice(2)}`;
const folder = `records/${SEASON}/`;

// A finished day never changes once ESPN settles its stats, so it is saved and only read once.
async function savedDays() {
  const { blobs } = await list({ prefix: folder, limit: 1000 });
  const days = await Promise.all(blobs.map(async b => {
    const r = await fetch(b.url, { cache: "no-store" });
    return r.ok ? [Number(b.pathname.match(/day-(\d+)/)[1]), await r.json()] : null;
  }));
  return new Map(days.filter(Boolean));
}

// Every rostered player's points that day, and whether he was in a starting lineup.
async function readDay(period, names) {
  const league = await espn(SEASON, ["mRoster"], { scoringPeriodId: period });
  const games = [];
  for (const t of league.teams) for (const e of t.roster?.entries || []) {
    const p = e.playerPoolEntry?.player;
    const stats = (p?.stats || []).filter(s => s.scoringPeriodId === period && s.statSourceId === 0);
    const day = stats.find(s => s.statSplitTypeId === 5) || stats[0];
    if (!day || !(day.appliedTotal > 0)) continue;
    games.push({ points: Math.round(day.appliedTotal * 10) / 10, id: p.id, player: p.fullName, owner: names[t.id]?.owner || "", bench: e.lineupSlotId === BENCH || e.lineupSlotId === IR });
  }
  return games;
}

// ESPN counts one scoring period per calendar day, so a period's date is today minus the gap.
function dateOf(period, today) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  now.setDate(now.getDate() - (today - period));
  return now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The site is not connected to ESPN yet." });
  try {
    const league = await espn(SEASON, ["mTeam", "mMatchupScore", "mSettings"]);
    const names = teamsOf(league);
    const today = league.scoringPeriodId || league.status?.latestScoringPeriod || 0;
    const first = league.status?.firstScoringPeriod || 1;
    const regular = league.settings?.scheduleSettings?.matchupPeriodCount || 99;

    const saved = await savedDays().catch(() => new Map());
    const games = [];
    const missing = [];
    for (let p = first; p <= today; p++) saved.has(p) ? games.push(...saved.get(p).map(g => ({ ...g, date: dateOf(p, today) }))) : missing.push(p);
    // A few days at a time, so ESPN is not hit with the whole season at once.
    for (let i = 0; i < missing.length; i += 6) {
      const batch = missing.slice(i, i + 6);
      const days = await Promise.all(batch.map(p => readDay(p, names)));
      await Promise.all(batch.map((p, j) => {
        games.push(...days[j].map(g => ({ ...g, date: dateOf(p, today) })));
        // Stats can still be corrected the day after, so only days older than that are kept.
        if (p > today - 2) return null;
        return put(`${folder}day-${p}.json`, JSON.stringify(days[j]), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" }).catch(() => null);
      }));
    }

    const byPoints = (a, b) => b.points - a.points;
    const strip = ({ bench, ...g }) => g;
    const started = games.filter(g => !g.bench).sort(byPoints);
    const best = {};
    started.forEach(g => { if (g.owner && !best[g.owner]) best[g.owner] = g; });

    // Finished matchups only: each side's total and the margin.
    const teams = [], results = [];
    for (const m of league.schedule || []) {
      if (!m.home || !m.away || !m.winner || m.winner === "UNDECIDED") continue;
      const base = { season: label, week: m.matchupPeriodId, playoff: m.matchupPeriodId > regular };
      const home = { owner: names[m.home.teamId]?.owner || "", points: m.home.totalPoints };
      const away = { owner: names[m.away.teamId]?.owner || "", points: m.away.totalPoints };
      teams.push({ ...base, ...home, against: away.owner }, { ...base, ...away, against: home.owner });
      const [w, l] = m.winner === "HOME" ? [home, away] : [away, home];
      results.push({ ...base, winner: w.owner, winner_points: w.points, loser: l.owner, loser_points: l.points, margin: Math.round((w.points - l.points) * 10) / 10 });
    }

    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=900, stale-while-revalidate=3600");
    res.status(200).json({
      season: label,
      days: Math.max(0, today - first + 1),
      games: started.slice(0, 10).map(strip),
      bench: games.filter(g => g.bench).sort(byPoints).slice(0, 10).map(strip),
      owners: Object.values(best).map(strip),
      high: [...teams].sort(byPoints).slice(0, 10),
      low: [...teams].sort((a, b) => a.points - b.points).slice(0, 10),
      blowouts: [...results].sort((a, b) => b.margin - a.margin).slice(0, 10),
      closest: [...results].sort((a, b) => a.margin - b.margin).slice(0, 10),
    });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}
