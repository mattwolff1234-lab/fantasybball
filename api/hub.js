import { SEASON, LOGO_HOST, connected, espn, teamsOf } from "../lib/espn.js";

// The home page, live from ESPN: this week's scores, the standings, last week's headlines and
// who is closest to being knocked out of the Gauntlet.
const OPENING = Date.UTC(2026, 9, 20); // ESPN's day 1
const dayOf = iso => Math.round((Date.parse(iso) - OPENING) / 864e5) + 1;
// Same cuts as the Gauntlet page: the lowest season total through each date is out.
const CUTS = [["Jan 4", "2027-01-03"], ["Feb 1", "2027-01-31"], ["Mar 1", "2027-02-28"]].map(([name, last]) => ({ name, last: dayOf(last) }));
const round1 = n => Math.round(n * 10) / 10;
const decided = m => m.winner && m.winner !== "UNDECIDED";

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The site is not connected to ESPN yet." });
  try {
    const league = await espn(SEASON, ["mTeam", "mMatchupScore", "mStatus", "mSettings"]);
    const names = teamsOf(league);
    const today = league.status.latestScoringPeriod, week = league.status.currentMatchupPeriod;
    const schedule = league.schedule.filter(m => m.home && m.away);

    const daily = {};
    for (const m of schedule) for (const side of [m.home, m.away]) {
      const days = daily[side.teamId] ??= {};
      for (const [day, pts] of Object.entries(side.pointsByScoringPeriod || {})) days[day] = (days[day] || 0) + pts;
    }
    const through = (id, last) => Object.entries(daily[id] || {}).reduce((s, [d, p]) => Number(d) <= last ? s + p : s, 0);

    const teams = league.teams.map(t => ({
      ...names[t.id], logo: (t.logo || "").replace(LOGO_HOST, "/api/logo?id="),
      w: t.record?.overall?.wins || 0, l: t.record?.overall?.losses || 0, seed: t.playoffSeed, points: round1(through(t.id, today)),
    })).sort((a, b) => a.seed - b.seed);

    const out = {};
    for (const c of CUTS) {
      if (today <= c.last) break;
      const low = teams.filter(t => !out[t.id]).sort((a, b) => through(a.id, c.last) - through(b.id, c.last))[0];
      out[low.id] = c.name;
    }
    const next = CUTS.find(c => today <= c.last);
    const alive = teams.filter(t => !out[t.id]).sort((a, b) => a.points - b.points);

    const side = s => ({ id: s.teamId, score: round1(s.totalPointsLive ?? s.totalPoints ?? 0) });
    const games = schedule.filter(m => m.matchupPeriodId === week).map(m => ({ home: side(m.home), away: side(m.away), final: decided(m) }));

    // The last finished week, for the recap card: its best score and its closest game.
    const finished = [...new Set(schedule.map(m => m.matchupPeriodId))].filter(w => schedule.filter(m => m.matchupPeriodId === w).every(decided));
    const lastFinal = finished.length ? Math.max(...finished) : null;
    let lastWeek = null;
    if (lastFinal) {
      const done = schedule.filter(m => m.matchupPeriodId === lastFinal);
      const best = done.flatMap(m => [m.home, m.away]).sort((a, b) => b.totalPoints - a.totalPoints)[0];
      const close = done.map(m => ({ m, gap: Math.abs(m.home.totalPoints - m.away.totalPoints) })).sort((a, b) => a.gap - b.gap)[0];
      const [win, lose] = close.m.winner === "HOME" ? [close.m.home, close.m.away] : [close.m.away, close.m.home];
      lastWeek = { week: lastFinal, top: { id: best.teamId, points: best.totalPoints }, closest: { winner: win.teamId, loser: lose.teamId, gap: round1(close.gap) } };
    }

    const date = new Date(OPENING + (today - 1) * 864e5);
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      year: SEASON, today, week, weekday: date.getUTCDay(),
      date: date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }),
      playoffTeams: league.settings?.scheduleSettings?.playoffTeamCount || 7,
      games, teams, lastWeek,
      gauntlet: { next: next ? { name: next.name, daysLeft: next.last - today } : null, out: Object.entries(out).map(([id, cut]) => ({ id: Number(id), cut })), alive: alive.map(t => t.id) },
    });
  } catch (e) {
    console.error(e);
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}
