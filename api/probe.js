// Temporary: shows the shape of ESPN's data while the weekly recap is built. Will be removed.
import { SEASON, BASE, connected, espn } from "../lib/espn.js";

const shape = (v, depth = 0) => {
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `len ${v.length}`] : [];
  if (v && typeof v === "object") {
    if (depth > 4) return "{…}";
    return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v === "string" ? v.slice(0, 40) : v;
};

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "no" });
  const out = {};
  const run = async (name, f) => { try { out[name] = await f(); } catch (e) { out[name] = "ERR " + e.message; } };
  await run("base", async () => {
    const l = await espn(SEASON, ["mMatchupScore", "mSettings", "mStatus"]);
    return {
      top: Object.keys(l), scoringPeriodId: l.scoringPeriodId, status: l.status,
      sched: shape(l.schedule?.[0]), schedLast: shape(l.schedule?.[l.schedule.length - 1]),
      scheduleSettings: shape(l.settings?.scheduleSettings), lineupSlotCounts: l.settings?.rosterSettings?.lineupSlotCounts,
      scoringType: l.settings?.scoringSettings?.scoringType,
    };
  });
  await run("roster", async () => {
    const l = await espn(SEASON, ["mRoster"], { scoringPeriodId: 15 });
    const e = l.teams[0].roster.entries;
    return { entry: shape(e[0]), slots: e.map(x => [x.lineupSlotId, x.playerPoolEntry.player.eligibleSlots]) };
  });
  await run("tx", async () => {
    const l = await espn(SEASON, ["mTransactions2"], { scoringPeriodId: 15 });
    return { top: Object.keys(l), n: l.transactions?.length, types: [...new Set((l.transactions || []).map(t => t.type + "/" + t.status))], sample: shape(l.transactions?.find(t => t.status === "EXECUTED")) };
  });
  await run("boxscore", async () => {
    const l = await espn(SEASON, ["mMatchup", "mMatchupScore"], { scoringPeriodId: 15 });
    const m = (l.schedule || []).find(x => x.home?.rosterForCurrentScoringPeriod);
    return { has: !!m, home: shape(m?.home) };
  });
  await run("pro", async () => {
    const r = await fetch(`${BASE}${SEASON}?view=proTeamSchedules_wl`);
    const j = await r.json();
    const t = j.settings?.proTeams?.[1];
    return { ok: r.status, sample: shape(t?.proGamesByScoringPeriod?.["15"]) };
  });
  await run("past", async () => {
    const l = await espn(2026, ["mMatchupScore", "mTeam"]);
    return { n: l.schedule?.length, teams: l.teams?.length, sched: shape(l.schedule?.[0]) };
  });
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(out);
}
