import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SEASON, POS, NBA, BASE, connected, teamsOf } from "../lib/espn.js";

// Late pickups and IR returns. ESPN locks every team's adds and drops at the day's first tip-off, and that
// setting can't be changed once the season has started. A league manager's moves go through
// straight away, though, so this makes the move as the league manager after checking the
// league's normal rules: the player is a free agent, nobody in the move has started his game,
// and the team has pickups left this week.
// Each manager signs in with a personal link. Only the SHA-256 of each link's key is kept here;
// the links themselves are in espn-tools/pickup-links.txt, outside the repo.
const KEYS = {
  "2183edf82d4917e1f0f320f028c5ba74238c6282f72c933a89c888f0354be80b": 1,
  "4314104848c5df2ed2b1aca6fa273f5b1869b3ae1e237d328b82c67d3bfc1db7": 2,
  "9683286b4b7b4aa5cfb185096334e77a24a9cda9ffc4a7d204d8a6e52586deda": 3,
  "836ff64c28039189f82a2ad76ce68053e3ee74722e6609dc42cc96cbf0b91fce": 5,
  "b637ddd86be9f92b18e831bf73b036e16da75498f84932cb508c1ea9c0c90469": 6,
  "0a299b52ca4c34d1c42604003b8fc2b3bffd5a7de6c2572f1822e48ebbee13d7": 7,
  "4ced688c0d0002d31fbf641fe678b4fad60895d06f25ca0a9b5a6c6e443c69c7": 8,
  "42d8452940d194c3b98b1be394c0acbe55758619440ff29187e4527dd992761d": 9,
  "593fa16b20305e2d86bb6beda6fc5047dd1c40ee7b3afca38656ad1ed3aaca52": 10,
  "9cf9d463b9229c702882f1ced708ce16ba534b412f2ab25ea680e106dcbe5373": 11,
};
const sha = s => createHash("sha256").update(s).digest("hex");
const teamFor = key => KEYS[sha(String(key || ""))] || signedTeam(key, "session");

// Or a manager signs in by email: the site emails a link that works for 30 minutes, and opening it
// signs that phone in for the season. Only the SHA-256 of each lowercased address is kept here.
// The signing secret comes from the Resend key, so replacing that key signs everyone out.
const EMAILS = {
  "71d7dcf98a975944d121be0511012bb249b4ea4cc06c342696e4494e063cb55b": 1,
  "0e2ee94db3a6b49628614d19617ae51bd92c421d13cf31e28b206550166cbc6c": 2,
  "daaf3dc95449d72e17d499f7778ad8c5ceab65f3d91280a28eea4a775c40eb7a": 3,
  "b771b0a184c4e27170302eda40a4b4f9ef6c7c0a3214f0c32638b41ef23bcf52": 6,
  "e8a5e1ba7c330bb604bd36575f5b2debbc625be19a2a5d115d096866b8b8e359": 8,
  "d88237bfacda1a4de37d3c5da849ef5f99eb265362734975df02982d2cae0350": 9,
  "11754e885786977e9cdf7300182c75dd9a51ce1bfc9ea27cbdbffacd6507d805": 10,
  "30c5a7cca391ef3faf7564b27eeabb93c63c6e95069e3b1042bfa466fd25ca72": 11,
  "a17fefb56e96f2110816ea9258c33d0746e03187f6dd662d4e0b8be5f83b321c": 7,
  "c359e01da55aa1914bd837cb79f505a0a26d01ed71b2e3a76fe02cabf2082ca7": 5,
};
const SITE = "https://www.fantasyhoops.fun";
const LINK_MS = 30 * 60 * 1000, SEASON_END = Date.parse("2027-06-01T00:00:00Z");
const secret = () => process.env.RESEND_API_KEY && createHash("sha256").update("fh-pickup|" + process.env.RESEND_API_KEY).digest();
const sign = (use, teamId, exp) => createHmac("sha256", secret()).update(`${use}.${teamId}.${exp}`).digest("base64url");
const token = (use, teamId, exp) => `${teamId}.${exp}.${sign(use, teamId, exp)}`;
function signedTeam(t, use) {
  const m = String(t || "").match(/^(\d+)\.(\d+)\.([\w-]+)$/);
  if (!m || !secret() || Date.now() > Number(m[2]) || !Object.values(KEYS).includes(Number(m[1]))) return;
  const want = Buffer.from(sign(use, m[1], m[2])), got = Buffer.from(m[3]);
  if (want.length === got.length && timingSafeEqual(want, got)) return Number(m[1]);
}

async function emailLink(res, address) {
  if (!secret()) return fail(res, 503, "Email sign-in isn't switched on yet. Use the personal link Matt sent you.");
  const email = String(address).trim().toLowerCase();
  const teamId = EMAILS[sha(email)];
  if (!teamId) return fail(res, 404, "That email isn't on Matt's list. Use the address you gave him, or ask him to add this one.");
  const link = `${SITE}/pickup.html#t=${token("link", teamId, Date.now() + LINK_MS)}`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Fantasy Hoops <pickups@fantasyhoops.fun>",
      to: email,
      subject: "Your Pickups sign-in link",
      text: `Open this link on the phone you'll make moves from, and it will sign you in to Pickups:\n\n${link}\n\nIt works for 30 minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Tap the button on the phone you'll make moves from, and it will sign you in to Pickups.</p><p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700">Sign in to Pickups</a></p><p style="color:#666;font-size:13px">It works for 30 minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  if (!r.ok) {
    console.error("Resend refused the sign-in email", r.status, await r.text());
    return fail(res, 502, "The email couldn't be sent. Try again, or tell Matt.");
  }
  res.status(200).json({ sent: true });
}

function signIn(res, link) {
  const teamId = signedTeam(link, "link");
  if (!teamId) return fail(res, 401, "That sign-in link has run out (they last 30 minutes). Ask for a new one below.");
  res.status(200).json({ key: token("session", teamId, SEASON_END) });
}

const INJURY = { OUT: "Out", DAY_TO_DAY: "Day to day", SUSPENSION: "Suspended", INJURY_RESERVE: "Injured reserve" };
const SLOT = { 0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C", 5: "G", 6: "F", 11: "UTIL", 12: "Bench", 13: "IR" };
const IR = 13, BENCH = 12;
// Where a player coming off IR should go, best first: a real position, then G/F style slots, UTIL, bench.
const PREFERRED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, BENCH];
const STARTING = PREFERRED.filter(s => s !== BENCH);
const starting = slot => STARTING.includes(slot);
const lineupItem = (e, to) => ({ playerId: e.playerId, type: "LINEUP", fromLineupSlotId: e.lineupSlotId, toLineupSlotId: to });
const round = n => n == null ? null : Math.round(n * 10) / 10;

const cookie = () => `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.SWID}`;

// Reads the league. `params` adds to the address (e.g. scoringPeriodId) and `filter` is ESPN's
// X-Fantasy-Filter, which picks which players or transactions come back.
async function espn(views, params = {}, filter) {
  const query = views.map(v => "view=" + v).concat(Object.entries(params).map(([k, v]) => `${k}=${v}`)).join("&");
  const headers = { Cookie: cookie() };
  if (filter) headers["X-Fantasy-Filter"] = JSON.stringify(filter);
  const r = await fetch(`${BASE}${SEASON}/segments/0/leagues/${process.env.LEAGUE_ID}?` + query, { headers });
  if (!r.ok) throw new Error("ESPN answered " + r.status);
  return r.json();
}

// Sends a roster move the way ESPN's own site does.
async function sendMove(body) {
  const r = await fetch(`https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/${SEASON}/segments/0/leagues/${process.env.LEAGUE_ID}/transactions/`, {
    method: "POST",
    headers: { Cookie: cookie(), "Content-Type": "application/json", "X-Fantasy-Platform": "espn-fantasy-web" },
    body: JSON.stringify({ ...body, memberId: process.env.SWID }),
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
}

// Who each NBA team plays today and when it tips off.
async function todaysGames(day) {
  const r = await fetch(`${BASE}${SEASON}?view=proTeamSchedules_wl`, { headers: { Cookie: cookie() } });
  if (!r.ok) throw new Error("ESPN answered " + r.status);
  const games = {};
  for (const t of (await r.json()).settings.proTeams) {
    const g = (t.proGamesByScoringPeriod[day] || [])[0];
    if (g) games[t.id] = { opp: NBA[g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId], home: g.homeProTeamId === t.id, at: g.date };
  }
  return games;
}

// `locked` is ESPN's own flag for a player whose game today has started.
function shape(entry, games) {
  const p = entry.player;
  const avg = id => round(p.stats?.find(s => s.id === id)?.appliedAverage);
  return {
    id: p.id,
    name: p.fullName,
    pos: (p.eligibleSlots || []).filter(s => s <= 4).map(s => POS[s + 1]),
    team: NBA[p.proTeamId] || "FA",
    injury: INJURY[p.injuryStatus] || "",
    avg: avg("00" + SEASON),
    last7: avg("01" + SEASON),
    game: games[p.proTeamId] || null,
    locked: !!entry.lineupLocked,
    can: (p.eligibleSlots || []).filter(s => starting(s) && SLOT[s]).map(s => SLOT[s]),
  };
}

const moveTime = t => t.processDate || t.proposedDate || 0;

// Everything one request needs, read fresh from ESPN. With `add`, only that player is looked up
// instead of the free-agent list.
async function load(teamId, add) {
  const league = await espn(["mTeam", "mRoster", "mSettings", "mStatus", "mMatchupScore"]);
  const day = league.scoringPeriodId, week = league.status.currentMatchupPeriod;
  // This week started the day after last week's last scored day.
  const lastWeek = league.schedule.filter(s => s.matchupPeriodId === week - 1)
    .flatMap(s => [s.home, s.away]).flatMap(t => Object.keys(t?.pointsByScoringPeriod || {})).map(Number);
  const firstDay = lastWeek.length ? Math.max(...lastWeek) + 1 : 1;
  const days = Array.from({ length: Math.max(day - firstDay + 1, 0) }, (_, i) => firstDay + i);
  const players = add
    ? { players: { filterIds: { value: [add] } } }
    : { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, limit: 250, sortPercOwned: { sortAsc: false, sortPriority: 1 } } };
  const rosterOn = d => espn(["mRoster"], { forTeamId: teamId, scoringPeriodId: d }).then(r => r.teams.find(t => t.id === teamId).roster);
  const [games, moves, pool, today, tomorrow] = await Promise.all([
    todaysGames(day),
    Promise.all(days.map(d => espn(["mTransactions2"], { scoringPeriodId: d }, { transactions: { filterType: { value: ["FREEAGENT", "WAIVER"] } } })
      .then(r => r.transactions || []))).then(all => all.flat().filter(t => t.status === "EXECUTED")),
    espn(["kona_player_info"], { scoringPeriodId: day }, players).then(r => r.players || []),
    rosterOn(day),
    rosterOn(day + 1).catch(() => null),
  ]);
  const team = league.teams.find(t => t.id === teamId);
  team.roster = today;
  // ESPN's weekly pickup count leaves out league manager moves, so those are counted from the log.
  const byLM = moves.filter(t => t.isLeagueManager).flatMap(t => t.items || []).filter(i => i.type === "ADD" && i.toTeamId === teamId).length;
  const used = (team.transactionCounter?.matchupAcquisitionTotals?.[week] || 0) + byLM;
  const limit = league.settings.acquisitionSettings.matchupAcquisitionLimit;
  const spots = Object.entries(league.settings.rosterSettings.lineupSlotCounts).reduce((n, [slot, c]) => n + (+slot === IR ? 0 : c), 0);
  const open = team.roster.entries.filter(e => e.lineupSlotId !== IR).length < spots;
  return { league, team, day, games, moves, pool, used, limit, open, blocked: closed(league, team), realign: realign(today, tomorrow) };
}

// After the lock, a lineup change made in the ESPN app only starts tomorrow, and from then on ESPN
// checks every move against tomorrow's lineup, so the page's moves get refused. These LINEUP items
// put tomorrow back to match today; sent first, they let the real move start today.
function realign(today, tomorrow) {
  if (!tomorrow) return [];
  const later = new Map(tomorrow.entries.map(e => [e.playerId, e.lineupSlotId]));
  return today.entries
    .filter(e => later.has(e.playerId) && later.get(e.playerId) !== e.lineupSlotId)
    .map(e => ({ playerId: e.playerId, type: "LINEUP", fromLineupSlotId: later.get(e.playerId), toLineupSlotId: e.lineupSlotId }));
}
async function lineUpTomorrow(res, teamId, day, items) {
  if (!items.length) return true;
  const result = await rosterMove(teamId, day, items);
  if (!result.ok) fail(res, 409, "You changed tomorrow's lineup in the ESPN app, and ESPN wouldn't let the page reset it. Undo that change in the app, then try again.");
  return result.ok;
}

// The Gauntlet's cuts, same rules as gauntlet.html: each counts games through the Sunday before it,
// and the lowest season total among teams still alive goes.
const OPENING = Date.UTC(2026, 9, 20);
const CUTS = [["January 4", "2027-01-03"], ["February 1", "2027-01-31"], ["March 1", "2027-02-28"]]
  .map(([name, last]) => ({ name, last: Math.round((Date.parse(last) - OPENING) / 864e5) + 1 }));
function cutOn(league, teamId) {
  const today = league.status.latestScoringPeriod;
  const daily = {};
  for (const m of league.schedule) for (const side of [m.home, m.away]) {
    if (!side) continue;
    const days = daily[side.teamId] ??= {};
    for (const [d, pts] of Object.entries(side.pointsByScoringPeriod || {})) days[d] = (days[d] || 0) + pts;
  }
  const through = (id, last) => { let sum = 0; for (let d = 1; d <= last; d++) sum += daily[id]?.[d] || 0; return sum; };
  const out = {};
  for (const c of CUTS) {
    if (today <= c.last) break;
    const alive = league.teams.filter(t => !out[t.id]);
    out[alive.reduce((a, b) => through(b.id, c.last) < through(a.id, c.last) ? b : a).id] = c;
  }
  return out[teamId];
}

// Why this team can't make moves any more, or null if it can.
function closed(league, team) {
  if (team.isTransactionLocked) return "Matt has locked your team's moves in ESPN, so this page can't make them either.";
  if (team.eliminated) return "Your team has been knocked out, so it can't make pickups any more.";
  const cut = cutOn(league, team.id);
  if (cut) return `Your team was cut from the Gauntlet on ${cut.name}, so it can't make pickups any more.`;
  return null;
}

// This week's pickups across the league, newest first, by name.
async function recent(league, moves, pool) {
  const names = new Map();
  league.teams.forEach(t => t.roster.entries.forEach(e => names.set(e.playerId, e.playerPoolEntry.player.fullName)));
  pool.forEach(e => names.set(e.id, e.player.fullName));
  const latest = moves.sort((a, b) => moveTime(b) - moveTime(a)).slice(0, 12);
  const missing = [...new Set(latest.flatMap(t => (t.items || []).map(i => i.playerId)))].filter(id => !names.has(id));
  if (missing.length) {
    const found = await espn(["kona_player_info"], {}, { players: { filterIds: { value: missing } } }).catch(() => ({}));
    (found.players || []).forEach(e => names.set(e.id, e.player.fullName));
  }
  const owners = teamsOf(league);
  return latest.map(t => ({
    at: moveTime(t),
    owner: owners[t.teamId]?.owner || "",
    added: (t.items || []).filter(i => i.type === "ADD").map(i => names.get(i.playerId) || "a player"),
    dropped: (t.items || []).filter(i => i.type === "DROP").map(i => names.get(i.playerId) || "a player"),
    late: !!t.isLeagueManager,
  }));
}

// ESPN's reasons for turning a move down, in plain words.
function refusal(result) {
  if (result.status === 401 || result.status === 403) return "The site's ESPN login has run out. Tell Matt so he can refresh it.";
  const d = result.data?.details?.[0] || {};
  const type = d.type || "";
  if (type.includes("ROSTER_LIMIT_EXCEEDED")) return "Your roster is full, so pick someone to drop.";
  if (type.includes("POSITION_LIMIT") || type.includes("SLOT_LIMIT")) return "That move would break a roster position limit.";
  return d.message || "ESPN turned the move down. Nothing on your team changed.";
}

const fail = (res, code, error) => res.status(code).json({ error });

// The page launches Monday Nov 16 at 9 AM Eastern. Until then it shows a countdown and refuses
// every move. PICKUP_OPENS_AT overrides the time, for testing.
const OPENS_AT = Date.parse(process.env.PICKUP_OPENS_AT || "2026-11-16T09:00:00-05:00");
const opensAt = () => Date.now() < OPENS_AT ? OPENS_AT : null;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!connected()) return fail(res, 503, "The site is not connected to ESPN yet.");
  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.email != null) return emailLink(res, body.email).catch(() => fail(res, 502, "The email couldn't be sent. Try again in a minute."));
    if (body.link) return signIn(res, body.link);
  }
  const teamId = teamFor(req.headers["x-pickup-key"]);
  if (!teamId) return res.status(401).json({ error: "This link isn't signed in. Use the personal link Matt sent you.", opensAt: opensAt(), now: Date.now() });
  if (req.method === "POST" && opensAt()) return fail(res, 403, "Pickups aren't open yet. They open Monday at 9 AM Eastern.");
  try {
    if (req.method === "GET") return await show(res, teamId);
    if (req.method === "POST") return await move(req, res, teamId);
    return fail(res, 405, "Use GET or POST");
  } catch (e) {
    return fail(res, 502, "Could not reach ESPN. Try again in a minute.");
  }
}

function emptyStarts(league, team) {
  const counts = league.settings.rosterSettings.lineupSlotCounts, used = {};
  team.roster.entries.forEach(e => used[e.lineupSlotId] = (used[e.lineupSlotId] || 0) + 1);
  return STARTING.filter(s => SLOT[s] && (counts[s] || 0) > (used[s] || 0)).map(s => SLOT[s]);
}

async function show(res, teamId) {
  const { league, team, day, games, moves, pool, used, limit, open, blocked } = await load(teamId);
  const me = teamsOf(league)[teamId];
  res.status(200).json({
    owner: me.owner,
    team: me.team,
    blocked,
    opensAt: opensAt(),
    now: Date.now(),
    espn: `https://fantasy.espn.com/basketball/team?leagueId=${process.env.LEAGUE_ID}&teamId=${teamId}`,
    day,
    used,
    limit,
    open,
    games: Object.keys(games).length,
    emptyStarts: emptyStarts(league, team),
    roster: team.roster.entries.map(e => ({
      ...shape(e.playerPoolEntry, games),
      slot: SLOT[e.lineupSlotId] || "",
      droppable: e.playerPoolEntry.player.droppable !== false,
    })),
    available: pool.filter(e => e.status === "FREEAGENT" || e.status === "WAIVERS").map(e => ({
      ...shape(e, games),
      waivers: e.status === "WAIVERS" ? e.waiverProcessDate || true : false,
    })),
    recent: await recent(league, moves, pool),
  });
}

// Finds a legal spot for a player coming off IR once `out` (if any) has gone. Takes the open
// spot if he can play it; otherwise a teammate who can fill the open spot shifts into it and he
// takes that teammate's place. Nobody whose game has started is moved. Answers the LINEUP
// items for ESPN and his new slot, or null when no spot works.
function placement(league, entries, back, out, slots = PREFERRED) {
  const counts = league.settings.rosterSettings.lineupSlotCounts;
  const used = {};
  entries.forEach(e => { if (e !== out && e !== back) used[e.lineupSlotId] = (used[e.lineupSlotId] || 0) + 1; });
  const open = slots.filter(s => (counts[s] || 0) > (used[s] || 0));
  const can = (e, s) => (e.playerPoolEntry.player.eligibleSlots || []).includes(s);
  const direct = open.find(s => can(back, s));
  if (direct != null) return { items: [lineupItem(back, direct)], slot: direct };
  for (const s of slots.filter(s => can(back, s))) {
    for (const free of open) {
      const shift = entries.find(e => e !== out && e.lineupSlotId === s && !e.playerPoolEntry.lineupLocked && can(e, free));
      if (shift) return { items: [lineupItem(shift, free), lineupItem(back, s)], slot: s };
    }
  }
  return null;
}

// ESPN won't let a manager move a player into the lineup on the day he was picked up after the
// lock, so the page does it. `sit` is the starter the manager chose to bench for him tonight.
// Answers that starter's entry, or an error message.
function checkSit(entries, sitId, incoming, outId) {
  const sit = entries.find(e => e.playerId === sitId);
  if (!sit || sit.playerId === outId) return { error: "That player isn't on your team any more." };
  const n = sit.playerPoolEntry.player.fullName, p = incoming.player;
  if (!starting(sit.lineupSlotId)) return { error: `${n} isn't in your starting lineup.` };
  if (sit.playerPoolEntry.lineupLocked) return { error: `${n}'s game today has already started, so he can't be moved until tomorrow.` };
  if (!(p.eligibleSlots || []).includes(sit.lineupSlotId)) return { error: `${p.fullName} can't play ${SLOT[sit.lineupSlotId]}, so he can't take ${n}'s spot.` };
  return { sit };
}

const rosterMove = (teamId, day, items) => sendMove({
  isLeagueManager: true,
  isActingAsTeamOwner: false,
  skipTransactionCounters: true,
  teamId,
  type: "ROSTER",
  scoringPeriodId: day,
  executionType: "EXECUTE",
  items,
});

// Brings a player off IR, dropping someone to make room if the roster is full. Not a pickup, so
// it doesn't count toward the weekly limit.
async function activate(res, teamId, backId, drop, sitId) {
  const { league, team, day, games, open, blocked, realign } = await load(teamId, backId);
  if (blocked) return fail(res, 403, blocked);
  const entries = team.roster.entries;
  const back = entries.find(e => e.playerId === backId);
  if (!back) return fail(res, 409, "That player isn't on your team any more.");
  const name = back.playerPoolEntry.player.fullName;
  if (back.lineupSlotId !== IR) return fail(res, 409, `${name} isn't on your IR.`);
  if (back.playerPoolEntry.lineupLocked) return fail(res, 409, `${name}'s game today has already started, so he can't come off IR until tomorrow.`);

  let out = null;
  if (drop) {
    out = entries.find(e => e.playerId === drop);
    if (!out) return fail(res, 409, "That player isn't on your team any more.");
    const outName = out.playerPoolEntry.player.fullName;
    if (out.lineupSlotId === IR) return fail(res, 409, `${outName} is on IR too, so dropping him doesn't free a spot. Drop someone from your lineup or bench.`);
    if (out.playerPoolEntry.lineupLocked) return fail(res, 409, `${outName}'s game today has already started, so he can't be dropped until tomorrow.`);
    if (out.playerPoolEntry.player.droppable === false) return fail(res, 409, `ESPN doesn't allow ${outName} to be dropped.`);
  } else if (!open) {
    return fail(res, 409, "Your roster is full, so pick someone to drop.");
  }
  let sit = null;
  if (sitId && games[back.playerPoolEntry.player.proTeamId]) {
    const check = checkSit(entries, sitId, back.playerPoolEntry, drop);
    if (check.error) return fail(res, 409, check.error);
    sit = check.sit;
    const bench = entries.filter(e => e !== out && e.lineupSlotId === BENCH).length;
    if (bench >= league.settings.rosterSettings.lineupSlotCounts[BENCH]) return fail(res, 409, `There's no room on your bench for ${sit.playerPoolEntry.player.fullName}. Drop someone from your bench instead.`);
  }
  const plan = sit ? { items: [lineupItem(sit, BENCH), lineupItem(back, sit.lineupSlotId)], slot: sit.lineupSlotId } : placement(league, entries, back, out);
  if (!plan) return fail(res, 409, `There's no spot ${name} can play in after that move. Try dropping someone else.`);

  if (!await lineUpTomorrow(res, teamId, day, realign)) return;
  const result = await rosterMove(teamId, day, [...(out ? [{ playerId: drop, type: "DROP", fromTeamId: teamId }] : []), ...plan.items]);
  if (!result.ok) return fail(res, 409, refusal(result));
  res.status(200).json({
    ok: true,
    back: { ...shape(back.playerPoolEntry, games), slot: SLOT[plan.slot] || "" },
    dropped: out ? out.playerPoolEntry.player.fullName : null,
    sat: sit ? sit.playerPoolEntry.player.fullName : null,
    realigned: realign.length > 0,
  });
}

async function move(req, res, teamId) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const sitId = body.sit ? Number(body.sit) : null;
  if (body.activate) return activate(res, teamId, Number(body.activate), body.drop ? Number(body.drop) : null, sitId);
  const add = Number(body.add), drop = body.drop ? Number(body.drop) : null;
  if (!add) return fail(res, 400, "Pick a player to add.");
  const { league, team, day, games, pool, used, limit, open, blocked, realign } = await load(teamId, add);
  if (blocked) return fail(res, 403, blocked);

  const entry = pool.find(e => e.id === add);
  if (!entry) return fail(res, 409, "ESPN couldn't find that player.");
  const name = entry.player.fullName;
  if (entry.status === "ONTEAM") {
    const owner = teamsOf(league)[entry.onTeamId]?.owner;
    return fail(res, 409, entry.onTeamId === teamId ? `${name} is already on your team.` : `${name} is on ${owner ? owner + "'s" : "another"} team.`);
  }
  if (entry.status === "WAIVERS") return fail(res, 409, `${name} is on waivers, so put in a claim for him in the ESPN app.`);
  if (entry.status !== "FREEAGENT") return fail(res, 409, `${name} isn't a free agent right now.`);
  if (entry.lineupLocked) return fail(res, 409, `${name}'s game today has already started, so he can't be added until tomorrow.`);

  let out = null;
  if (drop) {
    out = team.roster.entries.find(e => e.playerId === drop);
    if (!out) return fail(res, 409, "That player isn't on your team any more.");
    const outName = out.playerPoolEntry.player.fullName;
    if (out.playerPoolEntry.lineupLocked) return fail(res, 409, `${outName}'s game today has already started, so he can't be dropped until tomorrow.`);
    if (out.playerPoolEntry.player.droppable === false) return fail(res, 409, `ESPN doesn't allow ${outName} to be dropped.`);
    if (out.lineupSlotId === IR && !open) return fail(res, 409, `${outName} is on injured reserve, so dropping him doesn't free a spot for ${name}. Drop someone from your lineup or bench.`);
  } else if (!open) {
    return fail(res, 409, "Your roster is full, so pick someone to drop.");
  }
  if (limit > 0 && used >= limit) return fail(res, 409, `You've used all ${limit} pickups this week.`);
  const tonight = !!games[entry.player.proTeamId];
  let sit = null;
  if (sitId && tonight) {
    const check = checkSit(team.roster.entries, sitId, entry, drop);
    if (check.error) return fail(res, 409, check.error);
    sit = check.sit;
  }

  if (!await lineUpTomorrow(res, teamId, day, realign)) return;
  const result = await sendMove({
    isLeagueManager: true,
    isActingAsTeamOwner: false,
    skipTransactionCounters: true,
    teamId,
    type: "FREEAGENT",
    scoringPeriodId: day,
    executionType: "EXECUTE",
    items: [
      { playerId: add, type: "ADD", toTeamId: teamId },
      ...(drop ? [{ playerId: drop, type: "DROP", fromTeamId: teamId }] : []),
    ],
  });
  if (!result.ok) return fail(res, 409, refusal(result));
  const placed = (result.data?.items || []).find(i => i.type === "ADD" && i.playerId === add);
  let slot = placed ? placed.toLineupSlotId : BENCH, sat = null, benched = null;
  // A late pickup lands on the bench. If he still plays today, put him in the lineup: in the spot
  // the dropped starter left, or in place of the starter the manager chose.
  if (tonight && !starting(slot)) {
    const after = team.roster.entries.filter(e => e.playerId !== drop);
    const me = { playerId: add, lineupSlotId: slot, playerPoolEntry: entry };
    after.push(me);
    const plan = sit
      ? { items: [lineupItem(sit, BENCH), lineupItem(me, sit.lineupSlotId)], slot: sit.lineupSlotId }
      : placement(league, after, me, null, STARTING);
    if (plan) {
      const lineup = await rosterMove(teamId, day, plan.items);
      if (lineup.ok) { slot = plan.slot; sat = sit ? sit.playerPoolEntry.player.fullName : null; }
      else benched = true;
    }
  }
  res.status(200).json({
    ok: true,
    added: { ...shape(entry, games), slot: SLOT[slot] || "" },
    dropped: out ? out.playerPoolEntry.player.fullName : null,
    sat,
    benched,
    realigned: realign.length > 0,
    used: used + 1,
    limit,
  });
}
