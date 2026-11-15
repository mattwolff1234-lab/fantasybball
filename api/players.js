import { SEASON, NBA, connected, espn } from "../lib/espn.js";

// Every player worth ranking: his season so far, who has him, and how many games his NBA team
// has left in our fantasy season. The Rankings page blends this with the preseason projections.
const POS = ["PG", "SG", "SF", "PF", "C"];
const INJURY = { OUT: "Out", DAY_TO_DAY: "Day to day", SUSPENSION: "Suspended", INJURY_RESERVE: "Injured reserve" };
const round1 = n => Math.round(n * 10) / 10;

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The site is not connected to ESPN yet." });
  try {
    const sort = { sortAppliedStatTotal: { sortAsc: false, sortPriority: 1, value: "00" + SEASON } };
    const [league, rostered, free, nba] = await Promise.all([
      espn(SEASON, ["mStatus"]),
      espn(SEASON, ["kona_player_info"], {}, { players: { filterStatus: { value: ["ONTEAM"] }, limit: 300, ...sort } }),
      espn(SEASON, ["kona_player_info"], {}, { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, limit: 200, ...sort } }),
      fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${SEASON}?view=proTeamSchedules_wl`).then(r => r.json()),
    ]);
    const today = league.status.latestScoringPeriod, last = league.status.finalScoringPeriod, now = Date.now();
    // A game today still counts as left until it tips off.
    const left = {};
    for (const t of nba.settings?.proTeams || []) left[t.id] = Object.values(t.proGamesByScoringPeriod || {}).flat()
      .filter(g => g.scoringPeriodId >= today && g.scoringPeriodId <= last && g.date > now).length;

    const players = [...rostered.players, ...free.players].map(e => {
      const p = e.player, stats = p.stats || [];
      const season = stats.find(s => s.id === "00" + SEASON), recent = stats.find(s => s.id === "02" + SEASON);
      return {
        id: p.id, name: p.fullName, team: NBA[p.proTeamId] || "FA", fantasy: e.onTeamId || 0, waivers: e.status === "WAIVERS",
        pos: POS.filter((_, i) => (p.eligibleSlots || []).includes(i)), injury: INJURY[p.injuryStatus] || "",
        gp: season?.stats?.["42"] || 0, ppg: round1(season?.appliedAverage || 0),
        recent: recent?.stats?.["42"] ? round1(recent.appliedAverage) : null,
        espn: round1(stats.find(s => s.id === "10" + SEASON)?.appliedAverage || 0),
        left: left[p.proTeamId] || 0,
      };
    });
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=900");
    res.status(200).json({ year: SEASON, today, players });
  } catch (e) {
    console.error(e);
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}
