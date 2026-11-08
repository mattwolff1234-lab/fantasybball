// Rest-of-season value of a player, for the trade finder. Starts from this season's average,
// pulls it towards last season's while the sample is small, and counts only part of any jump
// that the news says comes from a teammate being hurt. Then multiplies by the games he should
// play from here to the end of the fantasy season.

export const K = 12;           // last season counts like this many games of this season
const K_ROOKIE = 3;            // a preseason guess at a rookie (or a player who barely played) is weak
const GAMES_PER_WEEK = 3.5;
export const COVERED = 0.5;    // share of a missed game a free-agent pickup fills in for, as in the draft guide
const DAY = 864e5;

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, few: 2, several: 3, couple: 2 };
const num = w => Number(w) || WORDS[String(w).toLowerCase()] || 0;
const NAME = "([A-Z][\\w'.-]+(?: (?:[A-Z][\\w'.-]+|Jr\\.|III|II)){0,2})";

// Phrases that mean a player's role is bigger because someone else is hurt. The name, when
// there is one, is the teammate.
const BOOST = [
  new RegExp(`absences? of (?:the )?(?:injured )?${NAME}`),
  new RegExp(`(?:filling|fill|filled|fills) in for (?:the )?(?:injured |sidelined )?${NAME}`),
  new RegExp(`in place of (?:the )?(?:injured |sidelined )?${NAME}`),
  new RegExp(`with ${NAME} (?:out|sidelined|injured|unavailable|still out|still sidelined)`),
  new RegExp(`while ${NAME} (?:is|remains) (?:out|sidelined)`),
  new RegExp(`(?:replacing|replaces|replaced) (?:the )?(?:injured )?${NAME}`),
  /\b(?:numerous|several|multiple|long-term) (?:injuries|absences)\b/i,
  /\b(?:short-?handed|depleted|injury-riddled|banged-up)\b/i,
  /\btemporary (?:fantasy )?(?:option|role|starter|starting role|boost|bump)\b/i,
];

// How long an injured player is expected to be out, from his own news.
function outFor(items, now) {
  for (const it of items) {
    const t = `${it.headline} ${it.story}`, age = (now - it.at) / DAY / 7;
    if (/season-ending|(?:rest|remainder) of the (?:regular )?season|out for the season|miss the season/i.test(t)) return { weeks: 99, note: "out for the season" };
    let m = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|ten|twelve|few|several|couple)(?:\s*(?:to|-|or)\s*(\d+|two|three|four|five|six|eight|ten|twelve))?(?: of)? months?\b/i);
    if (m) return { weeks: Math.max(0.5, num(m[2] || m[1]) * 4.3 - age), note: m[0] };
    m = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|ten|twelve|few|several|couple)(?:\s*(?:to|-|or)\s*(\d+|two|three|four|five|six|eight|ten|twelve))?(?:-| )weeks?\b/i);
    if (m) return { weeks: Math.max(0.3, num(m[2] || m[1]) - age), note: m[0] };
    if (/indefinitely|extended (?:period|absence)|long-term|significant time/i.test(t)) return { weeks: Math.max(1, 6 - age), note: "out indefinitely" };
  }
  return null;
}

// Why a player is out, if he is, and for how long.
export function injuryOf(items, status, now = Date.now()) {
  const recent = items.filter(it => now - it.at < 30 * DAY);
  if (status === "OUT") return outFor(recent, now) || { weeks: 1.5, note: "out, no timeline" };
  if (status === "DAY_TO_DAY") return { weeks: 0.3, note: "day to day" };
  return null;
}

// Whether the news says a player's role is bigger because a teammate is hurt. `teammates` are
// his teammates who play real minutes, each with `out` set if he is out now.
export function boostOf(items, teammates, now = Date.now()) {
  for (const it of items.filter(it => now - it.at < 21 * DAY)) {
    const t = `${it.headline} ${it.story}`;
    for (const re of BOOST) {
      const m = t.match(re);
      if (!m) continue;
      const last = n => n.split(" ").filter(w => !/^(Jr\.|III|II)$/.test(w)).pop();
      const named = m[1] && teammates.find(o => o.name.includes(m[1]) || m[1].includes(last(o.name)));
      // A name that is not a teammate (often the player's own name) means nothing.
      if (m[1] && !named) continue;
      return { teammate: named || null, phrase: m[0], at: it.at };
    }
  }
  return null;
}

const r1 = n => Math.round(n * 10) / 10;

// p: { cur, last, proj } as { ppg, gp, min } or null. ctx: { left, played, out, boost, injured,
// noNews, repl }, where `repl` is a free-agent pickup's points per game, where `out` and `boost` come from injuryOf and boostOf, `injured` are hurt
// teammates, and `noNews` means ESPN had no news on him to check.
// `left` is his NBA team's games from today to the end of the fantasy season; `played` is how
// many it has played so far.
export function valueOf(p, ctx) {
  const { cur, last, proj } = p;
  const why = [];
  let prior = null;
  if (last && last.gp >= 15) prior = last.ppg;
  else if (last && proj) prior = (last.ppg * last.gp + proj.ppg * (15 - last.gp)) / 15;
  else prior = proj?.ppg ?? last?.ppg ?? null;
  const n = cur?.gp || 0, now = cur?.ppg ?? 0;
  if (prior == null) prior = now;

  // An injury bump. `share` is how much of his season so far came without the teammate, and
  // `keep` how much of the rest of the season will. Only the bump in those games is taken off,
  // and only the part that will not carry on.
  let adjusted = now, boost = null;
  const b = ctx.boost, jumped = cur && last && last.gp >= 15 && cur.min - last.min >= 3;
  const pct = x => Math.round(x * 100) + "%";
  if (b && now > prior && n) {
    const mate = b.teammate;
    const share = mate ? Math.min(1, (mate.missed || 0) / n) : 0.5;
    const keep = !mate ? 0.35 : !mate.out ? 0 : Math.min(1, (mate.out.weeks * GAMES_PER_WEEK) / Math.max(1, ctx.left));
    const cut = share * (1 - keep);
    adjusted = now - (now - prior) * cut;
    boost = { teammate: mate?.name || null, cut: Math.round(cut * 100) / 100, phrase: b.phrase, back: !!(mate && !mate.out) };
    const missed = mate ? Math.min(n, mate.missed || 0) : 0;
    if (cut >= 0.05) why.push(!mate ? `News says his role is bigger because of injuries, so ${pct(cut)} of his jump over last season is taken off`
      : mate.out ? `${missed} of his ${n} games came with ${mate.name} out (${mate.out.note}), and ${mate.name.split(" ").pop()} should be back for ${pct(1 - keep)} of what is left, so ${pct(cut)} of the jump is taken off`
      : `${missed} of his ${n} games came with ${mate.name} out, and ${mate.name.split(" ").pop()} is back, so ${pct(cut)} of the jump is taken off`);
    if (cut < 0.05) boost = null;
  } else if (!b && ctx.noNews && jumped && ctx.injured?.length && now > prior) {
    // No news to go on, but minutes are up and a teammate is out.
    adjusted = now - (now - prior) * 0.3;
    boost = { teammate: null, cut: 0.3, phrase: "", back: false, guess: true };
    why.push(`Minutes are up ${r1(cur.min - last.min)} with ${ctx.injured[0].name} out, so 30% of his jump is taken off`);
  }
  const k = last && last.gp >= 15 ? K : K_ROOKIE;
  const ppg = n ? (n * adjusted + k * prior) / (n + k) : prior;
  if (n && last && last.gp >= 15) why.unshift(`${pct(n / (n + k))} this season (${r1(now)} in ${n} games), ${pct(k / (n + k))} last season (${r1(last.ppg)})`);
  else if (n) why.unshift(`${pct(n / (n + k))} this season (${r1(now)} in ${n} games), the rest ESPN's preseason projection (${r1(prior)})`);
  else if (last) why.unshift(`No games yet this season, so last season's ${r1(last.ppg)}`);

  // Games from here: his team's games left, less any he is out for, times how often he plays.
  const out = ctx.out;
  const lastRate = last ? Math.min(1, last.gp / 78) : 0.85;
  const health = Math.max(0.55, Math.min(0.97, out ? lastRate : (n + 30 * lastRate) / ((ctx.played || 0) + 30)));
  const missed = out ? Math.min(ctx.left, Math.round(out.weeks * GAMES_PER_WEEK)) : 0;
  const games = Math.max(0, ctx.left - missed) * health;
  if (out) why.push(missed >= ctx.left ? `Out for the rest of the fantasy season` : `Expected to miss about ${missed} game${missed === 1 ? "" : "s"} (${out.note})`);

  // A missed game is not a zero: a pickup plays some of them.
  const fill = COVERED * (ctx.repl || 0);
  return {
    ppg: r1(ppg), games: r1(games), missed, health: Math.round(health * 100) / 100,
    ros: Math.round(ppg * games + fill * (ctx.left - games)),
    // What ESPN shows everyone: this season's average over the games left.
    naive: Math.round((n >= 3 ? now : prior) * ctx.left * 0.85 + fill * ctx.left * 0.15),
    boost, why,
  };
}
