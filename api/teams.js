import { SEASON, POS, NBA, connected, espn, teamsOf } from "../lib/espn.js";

// Every team's current roster, read fresh from ESPN, so adds, drops and trades show up on the
// site by themselves.
const INJURY = { OUT: "Out", DAY_TO_DAY: "Day to day", SUSPENSION: "Suspended", INJURY_RESERVE: "Injured reserve" };

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The site is not connected to ESPN yet." });
  try {
    const league = await espn(SEASON, ["mTeam", "mRoster"]);
    const names = teamsOf(league);
    const teams = league.teams.map(t => ({
      ...names[t.id],
      wins: t.record?.overall?.wins || 0,
      losses: t.record?.overall?.losses || 0,
      roster: (t.roster?.entries || []).map(e => {
        const p = e.playerPoolEntry.player;
        return { id: p.id, name: p.fullName, pos: POS[p.defaultPositionId] || "", team: NBA[p.proTeamId] || "FA", injury: INJURY[p.injuryStatus] || "" };
      }),
    }));
    // Rosters only change a few times a day, so a minute of sharing between viewers is plenty.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ year: SEASON, teams });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}
