import { SEASON, LOGO_HOST, connected, espn, teamsOf } from "../lib/espn.js";

// Every team's fantasy points day by day, read fresh from ESPN, for the Gauntlet race.
// ESPN counts the season in days: day 1 is opening night, and today's games count as they're played.
export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The site is not connected to ESPN yet." });
  try {
    const league = await espn(SEASON, ["mTeam", "mMatchupScore", "mStatus"]);
    const names = teamsOf(league);
    const today = league.status.latestScoringPeriod;
    const daily = {};
    for (const m of league.schedule) for (const side of [m.home, m.away]) {
      if (!side) continue;
      const days = daily[side.teamId] ??= {};
      for (const [day, pts] of Object.entries(side.pointsByScoringPeriod || {})) days[day] = (days[day] || 0) + pts;
    }
    const teams = league.teams.map(t => ({
      ...names[t.id],
      logo: (t.logo || "").replace(LOGO_HOST, "/api/logo?id="),
      points: Array.from({ length: today }, (_, i) => daily[t.id]?.[i + 1] || 0),
    }));
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ year: SEASON, today, teams });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}
