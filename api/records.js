// This season's entries for the Records page: every player's game on every day, and every
// finished matchup, read from ESPN. The page merges these into the all-time lists, which come
// from earlier seasons (public/records-data.js).
import { SEASON, connected, espn, teamsOf } from "../lib/espn.js";
import { BENCH, IR, loadDays, dateOf } from "../lib/days.js";

const label = `${SEASON - 1}-${String(SEASON).slice(2)}`;

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The site is not connected to ESPN yet." });
  try {
    const league = await espn(SEASON, ["mTeam", "mMatchupScore", "mSettings"]);
    const names = teamsOf(league);
    const today = league.scoringPeriodId || league.status?.latestScoringPeriod || 0;
    const first = league.status?.firstScoringPeriod || 1;
    const regular = league.settings?.scheduleSettings?.matchupPeriodCount || 99;

    const periods = [];
    for (let p = first; p <= today; p++) periods.push(p);
    const [days, date] = await Promise.all([loadDays(periods, today), dateOf(today)]);
    const games = [];
    for (const [period, day] of days) for (const [team, players] of Object.entries(day.teams))
      for (const [id, points, slot] of players) if (points > 0)
        games.push({ points, id, player: day.names[id], owner: names[team]?.owner || "", date: date(period), bench: slot === BENCH || slot === IR });

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
      days: periods.length,
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
