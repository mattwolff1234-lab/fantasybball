// Draft rankings from ESPN stat lines. Shared by the draft guide page and its test.
// Categories: each player's value is the sum of z-scores across the league's categories, measured against the
// players who would actually get drafted (teams x 13). Percentages count by impact (attempts x distance from the pool's
// average) so a 60% shooter on 3 shots a game doesn't outrank one on 15. Points: ESPN fantasy points per game.
export const NINE_CAT = ["FG%", "FT%", "3PM", "REB", "AST", "STL", "BLK", "PTS", "TO"].map(stat => ({ stat, reverse: stat === "TO" }));
// ESPN's default points league scoring
export const ESPN_POINTS = { PTS: 1, "3PM": 1, FGA: -1, FGM: 2, FTA: -1, FTM: 1, REB: 1, AST: 2, STL: 4, BLK: 4, TO: -2 };
const PCT = { "FG%": ["FGM", "FGA"], "FT%": ["FTM", "FTA"], "3P%": ["3PM", "3PA"] };
const ROSTER = 13;

// opts: { mode: "cats" | "points", cats, points, source: "proj" | "last", season: bool, teams }
export function rank(players, opts) {
  const teams = opts.teams || 10;
  const scale = (l, k) => (l[k] || 0) * (opts.season ? l.GP || 0 : 1);
  const rows = players.map(p => {
    const l = (opts.source === "last" ? p.last || p.now : p.proj || p.last) || null;
    return l && { p, l };
  }).filter(Boolean);

  if (opts.mode === "points") {
    const pts = opts.points && Object.keys(opts.points).length ? opts.points : ESPN_POINTS;
    rows.forEach(r => { r.value = Object.entries(pts).reduce((s, [k, w]) => s + w * scale(r.l, k), 0); r.z = {}; });
  } else {
    const cats = opts.cats && opts.cats.length ? opts.cats : NINE_CAT;
    let pool = rows;
    // Two passes: rank everyone, then re-measure against only the top of the draft.
    for (let pass = 0; pass < 2; pass++) {
      const ref = {};
      for (const c of cats) {
        if (PCT[c.stat]) {
          const [m, a] = PCT[c.stat];
          const made = pool.reduce((s, r) => s + scale(r.l, m), 0), att = pool.reduce((s, r) => s + scale(r.l, a), 0);
          ref[c.stat] = { pct: att ? made / att : 0 };
        }
        const raw = r => PCT[c.stat] ? scale(r.l, PCT[c.stat][1]) * ((r.l[c.stat] || 0) - ref[c.stat].pct) : scale(r.l, c.stat);
        const vals = pool.map(raw), mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
        const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length || 1)) || 1;
        ref[c.stat] = { ...ref[c.stat], raw, mean, sd };
      }
      rows.forEach(r => {
        r.z = {};
        for (const c of cats) { const f = ref[c.stat]; r.z[c.stat] = (c.reverse ? -1 : 1) * (f.raw(r) - f.mean) / f.sd; }
        r.value = Object.values(r.z).reduce((s, v) => s + v, 0);
      });
      pool = [...rows].sort((a, b) => b.value - a.value).slice(0, teams * ROSTER);
    }
  }

  rows.sort((a, b) => b.value - a.value);
  // Tiers break at the biggest drops: a drop well above the median drop across the draftable pool starts a new tier,
  // and no tier runs longer than one round.
  const draftable = Math.min(rows.length, teams * ROSTER);
  const gaps = rows.slice(1, draftable).map((r, i) => rows[i].value - r.value).sort((x, y) => x - y);
  const med = gaps[Math.floor(gaps.length / 2)] || 0;
  let tier = 1, start = 0;
  rows.forEach((r, i) => {
    r.rank = i + 1; r.round = Math.ceil(r.rank / teams);
    const gap = i ? rows[i - 1].value - r.value : 0;
    if (i && i - start >= 3 && (gap > med * 3 || i - start >= teams)) { tier++; start = i; }
    r.tier = tier;
  });
  return rows;
}
