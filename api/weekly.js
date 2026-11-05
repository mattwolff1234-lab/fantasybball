// The weekly recap: everything about one matchup week, read from ESPN. Scores, each team's best
// and worst players, points left on the bench, waiver moves, awards, power rankings, standings
// and the all-time head-to-head record of every matchup. ?week=N picks the week; the default is
// the last finished one.
import { list, put } from "@vercel/blob";
import { SEASON, connected, espn, teamsOf } from "../lib/espn.js";
import { BENCH, IR, loadDays, bestLineup, dateOf, playerNames } from "../lib/days.js";

const seasonLabel = y => `${y - 1}-${String(y).slice(2)}`;
const round1 = n => Math.round(n * 10) / 10;
const decided = m => m.winner && m.winner !== "UNDECIDED";
// A game that counts in the head-to-head: decided, not a consolation game, and not involving a
// team already knocked out (the guillotine year).
const out = (side, m) => side.eliminationMatchupPeriod > 0 && side.eliminationMatchupPeriod < m.matchupPeriodId;
const real = m => m.home && m.away && decided(m) && ["NONE", "WINNERS_BRACKET", undefined].includes(m.playoffTierType) && !out(m.home, m) && !out(m.away, m);

// Every finished matchup from earlier seasons, by owner name. The past never changes, so this is
// read from ESPN once and saved.
async function pastMeetings(years) {
  const path = `h2h/v2-before-${SEASON}.json`;
  try {
    const { blobs } = await list({ prefix: path, limit: 1 });
    if (blobs[0]) { const r = await fetch(blobs[0].url, { cache: "no-store" }); if (r.ok) return r.json(); }
  } catch (e) { /* read from ESPN below */ }
  const seasons = await Promise.all(years.map(y => espn(y, ["mMatchupScore", "mTeam", "mSettings"]).then(l => [y, l]).catch(() => null)));
  const meetings = [];
  for (const s of seasons.filter(Boolean)) {
    const [year, l] = s, names = teamsOf(l), regular = l.settings?.scheduleSettings?.matchupPeriodCount || 99;
    for (const m of l.schedule || []) {
      if (!real(m)) continue;
      const a = names[m.home.teamId]?.owner, b = names[m.away.teamId]?.owner;
      if (!a || !b) continue;
      meetings.push({ season: seasonLabel(year), week: m.matchupPeriodId, playoff: m.playoffTierType === "WINNERS_BRACKET", a, b, ap: m.home.totalPoints, bp: m.away.totalPoints, winner: m.winner === "HOME" ? a : m.winner === "AWAY" ? b : null });
    }
  }
  if (seasons.every(Boolean)) await put(path, JSON.stringify(meetings), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" }).catch(() => null);
  return meetings;
}

function headToHead(meetings, a, b) {
  const games = meetings.filter(m => (m.a === a && m.b === b) || (m.a === b && m.b === a));
  const last = games[games.length - 1];
  return {
    [a]: games.filter(m => m.winner === a).length, [b]: games.filter(m => m.winner === b).length,
    games: games.length, playoffs: games.filter(m => m.playoff).length,
    last: last ? { season: last.season, week: last.week, playoff: last.playoff, winner: last.winner, score: [last.a === last.winner ? last.ap : last.bp, last.a === last.winner ? last.bp : last.ap] } : null,
  };
}

// Season-to-date standing of every team through `week`: record, points, all-play record (as if
// it played every team every week), luck, and a power score.
function standings(schedule, ids, week) {
  const t = Object.fromEntries(ids.map(id => [id, { w: 0, l: 0, ties: 0, pf: 0, pa: 0, apw: 0, apl: 0, results: [], weeks: 0 }]));
  const byWeek = {};
  for (const m of schedule) if (m.matchupPeriodId <= week && decided(m)) (byWeek[m.matchupPeriodId] ||= []).push(m);
  for (const games of Object.values(byWeek)) {
    const scores = games.flatMap(m => [[m.home.teamId, m.home.totalPoints], [m.away.teamId, m.away.totalPoints]]);
    for (const [id, pts] of scores) {
      if (!t[id]) continue;
      t[id].apw += scores.filter(([o, p]) => o !== id && p < pts).length;
      t[id].apl += scores.filter(([o, p]) => o !== id && p > pts).length;
    }
    for (const m of games) for (const [me, them, win] of [[m.home, m.away, "HOME"], [m.away, m.home, "AWAY"]]) {
      const s = t[me.teamId];
      if (!s) continue;
      const r = m.winner === "TIE" ? "T" : m.winner === win ? "W" : "L";
      s[r === "W" ? "w" : r === "L" ? "l" : "ties"]++;
      s.pf += me.totalPoints; s.pa += them.totalPoints; s.weeks++;
      s.results.push(r);
    }
  }
  const maxAvg = Math.max(1, ...Object.values(t).map(s => s.weeks ? s.pf / s.weeks : 0));
  for (const s of Object.values(t)) {
    const g = s.w + s.l + s.ties, ap = s.apw + s.apl;
    s.apPct = ap ? s.apw / ap : 0;
    s.expected = round1(s.apPct * g);
    s.luck = round1(s.w + s.ties / 2 - s.apPct * g);
    // Half all-play win rate, three tenths scoring, a fifth actual record.
    s.power = g ? round1(100 * (0.5 * s.apPct + 0.3 * (s.pf / s.weeks) / maxAvg + 0.2 * (s.w + s.ties / 2) / g)) : 0;
    let n = 0; const last = s.results[s.results.length - 1];
    for (let i = s.results.length - 1; i >= 0 && s.results[i] === last; i--) n++;
    s.streak = last ? last + n : "";
  }
  const order = ids.slice().sort((a, b) => t[b].power - t[a].power || t[b].pf - t[a].pf);
  order.forEach((id, i) => t[id].rank = i + 1);
  return t;
}

export default async function handler(req, res) {
  if (!connected()) return res.status(503).json({ error: "The site is not connected to ESPN yet." });
  try {
    const league = await espn(SEASON, ["mTeam", "mMatchupScore", "mSettings", "mDraftDetail"]);
    const names = teamsOf(league), ids = Object.keys(names).map(Number);
    const today = league.scoringPeriodId || league.status?.latestScoringPeriod || 0;
    const current = league.status?.currentMatchupPeriod || 1;
    const regular = league.settings?.scheduleSettings?.matchupPeriodCount || 99;
    const slotCounts = league.settings?.rosterSettings?.lineupSlotCounts || {};
    const schedule = (league.schedule || []).filter(m => m.home && m.away);
    const date = await dateOf(today);

    const weekInfo = w => {
      const games = schedule.filter(m => m.matchupPeriodId === w);
      const periods = [...new Set(games.flatMap(m => [...Object.keys(m.home.pointsByScoringPeriod || {}), ...Object.keys(m.away.pointsByScoringPeriod || {})]).map(Number))].sort((a, b) => a - b);
      return { week: w, final: games.length > 0 && games.every(decided), playoff: w > regular, periods, start: periods[0], end: periods[periods.length - 1] };
    };
    const weeks = [];
    for (let w = 1; w <= current; w++) weeks.push(weekInfo(w));
    const lastFinal = [...weeks].reverse().find(w => w.final);
    const asked = Number(req.query.week);
    const info = weeks.find(w => w.week === asked) || lastFinal || weeks[weeks.length - 1];
    const week = info.week;
    const games = schedule.filter(m => m.matchupPeriodId === week);
    const periods = info.periods.filter(p => p <= today);

    const [days, past, everyone] = await Promise.all([
      loadDays(periods, today),
      pastMeetings((league.status?.previousSeasons || []).filter(y => y >= 2019 && y < SEASON)).catch(() => []),
      playerNames().catch(() => ({})),
    ]);
    const thisSeason = schedule.filter(real).map(m => ({ season: seasonLabel(SEASON), week: m.matchupPeriodId, playoff: m.playoffTierType === "WINNERS_BRACKET", a: names[m.home.teamId]?.owner, b: names[m.away.teamId]?.owner, ap: m.home.totalPoints, bp: m.away.totalPoints, winner: m.winner === "HOME" ? names[m.home.teamId]?.owner : m.winner === "AWAY" ? names[m.away.teamId]?.owner : null }));
    const meetings = [...past, ...thisSeason];

    // Draft slot of every player, for "bust of the week".
    const drafted = {};
    for (const p of league.draftDetail?.picks || []) if (p.playerId > 0) drafted[p.playerId] = { round: p.roundId, pick: p.overallPickNumber, team: p.teamId };

    // Day by day: each team's started points, the best lineup it could have set, and each
    // player's points as a starter and on the bench.
    const team = Object.fromEntries(ids.map(id => [id, { actual: 0, optimal: 0, bench: 0, games: 0, bestDay: null, players: {} }]));
    const nameOf = id => everyone[id] || [...days.values()].map(d => d.names[id]).find(Boolean) || "Unknown";
    const singles = [];
    for (const p of periods) {
      const day = days.get(p);
      if (!day) continue;
      for (const [tid, players] of Object.entries(day.teams)) {
        const s = team[tid];
        if (!s) continue;
        let actual = 0;
        for (const [id, pts, slot, , played] of players) {
          const me = s.players[id] ||= { id, name: day.names[id], points: 0, games: 0, benchPoints: 0, benchGames: 0 };
          if (slot < BENCH) {
            actual += pts; me.points += pts;
            if (played) { me.games++; s.games++; }
            if (pts > 0) singles.push({ id, player: day.names[id], owner: names[tid].owner, points: pts, date: date(p) });
          } else if (slot === BENCH) {
            s.bench += pts; me.benchPoints += pts;
            if (played) me.benchGames++;
          }
        }
        s.actual += actual;
        s.optimal += bestLineup(players, slotCounts);
        if (!s.bestDay || actual > s.bestDay.points) s.bestDay = { points: round1(actual), date: date(p, { weekday: "long", month: "short", day: "numeric" }) };
      }
    }

    // Waiver, free agent and trade moves made this week, with what the new players scored. Each
    // player's first and last move decide what happened: picked up, streamed (picked up and let go),
    // dropped, or dropped and picked straight back up (left out).
    const seen = new Set(), log = Object.fromEntries(ids.map(id => [id, {}]));
    const txs = periods.flatMap(p => days.get(p)?.tx || []).sort((a, b) => a.at - b.at);
    for (const t of txs) {
      const key = `${t.at}-${t.team}-${t.items.map(i => i.player).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const trade = t.type.startsWith("TRADE");
      const note = (tid, pid, act) => { if (log[tid]) (log[tid][pid] ||= []).push(act); };
      for (const i of t.items) {
        if (i.type === "ADD" || (trade && i.to)) note(i.to, i.player, trade ? "trade" : "add");
        if (i.type === "DROP" || (trade && i.from)) note(i.from, i.player, trade ? "traded" : "drop");
      }
    }
    const moves = Object.fromEntries(ids.map(id => [id, Object.entries(log[id]).map(([pid, acts]) => {
      const first = acts[0], last = acts[acts.length - 1], came = first === "add" || first === "trade";
      const kind = came ? (last === "drop" || last === "traded" ? "streamed" : first) : (last === "add" || last === "trade" ? null : first);
      const points = round1(team[id].players[pid]?.points || 0);
      return kind && { kind, id: Number(pid), name: nameOf(Number(pid)), ...(came ? { points } : {}) };
    }).filter(Boolean)]));

    const table = standings(schedule, ids, week);
    const before = week > 1 ? standings(schedule, ids, week - 1) : null;
    const scores = games.flatMap(m => [[m.home.teamId, m.home.totalPointsLive ?? m.home.totalPoints], [m.away.teamId, m.away.totalPointsLive ?? m.away.totalPoints]]);
    const nextGames = schedule.filter(m => m.matchupPeriodId === week + 1);

    const teams = ids.map(id => {
      const s = team[id], st = table[id], g = games.find(m => m.home.teamId === id || m.away.teamId === id);
      const home = g && g.home.teamId === id, me = g && (home ? g.home : g.away), them = g && (home ? g.away : g.home);
      const points = round1(me ? (me.totalPointsLive ?? me.totalPoints) : s.actual);
      const opp = them ? round1(them.totalPointsLive ?? them.totalPoints) : 0;
      const players = Object.values(s.players).map(p => ({ ...p, points: round1(p.points), benchPoints: round1(p.benchPoints) }));
      const starters = players.filter(p => p.games > 0).sort((a, b) => b.points - a.points);
      const regulars = starters.filter(p => p.games >= 2);
      const dud = regulars.length > 3 ? [...regulars].sort((a, b) => a.points / a.games - b.points / b.games)[0] : null;
      const benchBest = players.filter(p => p.benchPoints > 0).sort((a, b) => b.benchPoints - a.benchPoints)[0] || null;
      const next = nextGames.find(m => m.home.teamId === id || m.away.teamId === id);
      const nextOpp = next && names[next.home.teamId === id ? next.away.teamId : next.home.teamId].owner;
      const result = g && decided(g) ? (g.winner === "TIE" ? "T" : (g.winner === "HOME") === home ? "W" : "L") : null;
      return {
        id, owner: names[id].owner, team: names[id].team,
        points, opponent: them ? names[them.teamId].owner : null, oppPoints: opp, result, margin: round1(points - opp),
        rank: 1 + scores.filter(([o, p]) => o !== id && p > points).length,
        allPlay: [scores.filter(([o, p]) => o !== id && p < points).length, scores.filter(([o, p]) => o !== id && p > points).length],
        record: [st.w, st.l, st.ties], streak: st.streak, pf: round1(st.pf), pa: round1(st.pa),
        seasonAllPlay: [st.apw, st.apl], expected: st.expected, luck: st.luck,
        power: st.power, powerRank: st.rank, powerMove: before ? before[id].rank - st.rank : 0,
        actual: round1(s.actual), optimal: round1(s.optimal), left: round1(Math.max(0, s.optimal - s.actual)),
        efficiency: s.optimal ? Math.round(1000 * s.actual / s.optimal) / 10 : 0,
        bench: round1(s.bench), benchBest: benchBest && { id: benchBest.id, name: benchBest.name, points: benchBest.benchPoints, games: benchBest.benchGames },
        games: s.games, bestDay: s.bestDay,
        top: starters.slice(0, 3).map(p => ({ id: p.id, name: p.name, points: p.points, games: p.games })),
        dud: dud && { id: dud.id, name: dud.name, points: dud.points, games: dud.games },
        moves: moves[id],
        next: nextOpp ? { opponent: nextOpp, h2h: headToHead(meetings, names[id].owner, nextOpp) } : null,
      };
    }).sort((a, b) => a.powerRank - b.powerRank);

    const matchups = games.map(m => {
      const a = teams.find(t => t.id === m.home.teamId), b = teams.find(t => t.id === m.away.teamId);
      return { home: { owner: a.owner, team: a.team, points: a.points }, away: { owner: b.owner, team: b.team, points: b.points }, winner: decided(m) ? m.winner : null, margin: round1(Math.abs(a.points - b.points)), h2h: headToHead(meetings, a.owner, b.owner) };
    }).sort((x, y) => (y.home.points + y.away.points) - (x.home.points + x.away.points));

    // Awards. Each one names a winner and the number behind it.
    const awards = [];
    const add = (key, title, t, value, detail, id) => t && awards.push({ key, title, owner: t.owner || t, value, detail, id });
    const byPts = [...teams].sort((a, b) => b.points - a.points);
    add("top", "Top score", byPts[0], byPts[0].points, `${byPts[0].allPlay[0]}-${byPts[0].allPlay[1]} against the whole league`);
    add("low", "Basement", byPts[byPts.length - 1], byPts[byPts.length - 1].points, "Lowest score of the week");
    const allStarters = teams.flatMap(t => Object.values(team[t.id].players).filter(p => p.games > 0).map(p => ({ ...p, owner: t.owner })));
    const potw = allStarters.sort((a, b) => b.points - a.points)[0];
    if (potw) add("player", "Player of the week", potw.owner, round1(potw.points), `${potw.name}, ${potw.games} games as a starter`, potw.id);
    const game = singles.sort((a, b) => b.points - a.points)[0];
    if (game) add("game", "Game of the week", game.owner, game.points, `${game.player} on ${game.date.replace(/, \d{4}$/, "")}`, game.id);
    if (info.final || matchups.some(m => m.winner)) {
      const done = matchups.filter(m => m.winner);
      const win = m => m.winner === "HOME" ? m.home : m.away, lose = m => m.winner === "HOME" ? m.away : m.home;
      const blow = [...done].sort((a, b) => b.margin - a.margin)[0], close = [...done].sort((a, b) => a.margin - b.margin)[0];
      if (blow) add("blowout", "Blowout", win(blow).owner, blow.margin, `Over ${lose(blow).owner}, ${win(blow).points} to ${lose(blow).points}`);
      if (close && close !== blow) add("close", "Nail-biter", win(close).owner, close.margin, `Over ${lose(close).owner}, ${win(close).points} to ${lose(close).points}`);
      const lucky = teams.filter(t => t.result === "W").sort((a, b) => a.points - b.points)[0];
      if (lucky && lucky.rank > teams.length / 2) add("lucky", "Lucky win", lucky, lucky.points, `Won with the ${place(lucky.rank)} best score`);
      const sad = teams.filter(t => t.result === "L").sort((a, b) => b.points - a.points)[0];
      if (sad && sad.rank <= teams.length / 2) add("heartbreak", "Heartbreaker", sad, sad.points, `Lost with the ${place(sad.rank)} best score`);
    }
    const blunder = [...teams].sort((a, b) => b.left - a.left)[0];
    add("bench", "Bench blunder", blunder, blunder.left, `Points left on the bench with the best possible lineups${blunder.benchBest ? `, ${blunder.benchBest.name} sat for ${blunder.benchBest.points}` : ""}`);
    const sharp = [...teams].sort((a, b) => b.efficiency - a.efficiency)[0];
    add("coach", "Coach of the week", sharp, sharp.efficiency + "%", "Closest to the best possible lineup every day");
    const pickup = teams.flatMap(t => t.moves.filter(m => m.kind === "add" || m.kind === "streamed").map(m => ({ ...m, owner: t.owner }))).sort((a, b) => b.points - a.points)[0];
    if (pickup && pickup.points > 0) add("waiver", "Waiver hero", pickup.owner, pickup.points, `${pickup.name}, picked up this week`, pickup.id);
    const iron = [...teams].sort((a, b) => b.games - a.games)[0];
    add("volume", "Volume king", iron, iron.games, "Most games played by starters");
    const busts = allStarters.filter(p => p.games >= 2 && drafted[p.id]?.round <= 3).map(p => ({ ...p, ppg: p.points / p.games })).sort((a, b) => a.ppg - b.ppg);
    if (busts[0]) add("bust", "Bust watch", busts[0].owner, round1(busts[0].ppg) + " a game", `${busts[0].name}, a round ${drafted[busts[0].id].round} pick`, busts[0].id);

    const next = nextGames.map(m => {
      const a = names[m.home.teamId].owner, b = names[m.away.teamId].owner;
      return { home: { owner: a, record: table[m.home.teamId] && [table[m.home.teamId].w, table[m.home.teamId].l] }, away: { owner: b, record: table[m.away.teamId] && [table[m.away.teamId].w, table[m.away.teamId].l] }, h2h: headToHead(meetings, a, b) };
    });

    res.setHeader("Cache-Control", info.final ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" : "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      season: seasonLabel(SEASON), year: SEASON, week, final: info.final, playoff: info.playoff,
      dates: periods.length ? [date(periods[0]), date(info.periods[info.periods.length - 1])] : [],
      weeks: weeks.map(w => ({ week: w.week, final: w.final, playoff: w.playoff })),
      matchups, teams, awards, next,
    });
  } catch (e) {
    console.error(e);
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Could not reach ESPN." });
  }
}

function place(n) { return n + (["th", "st", "nd", "rd"][n % 10 > 3 || (n > 10 && n < 14) ? 0 : n % 10]); }
