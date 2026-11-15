// Shared by the functions that read the league from ESPN. The league's login is kept in
// Vercel's settings (ESPN_S2, SWID, LEAGUE_ID) and never in the repo.
export const SEASON = 2027; // ESPN names a season by the year it ends in
export const POS = { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" };
export const NBA = ["", "ATL", "BOS", "NOP", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MIA", "MIL", "MIN", "BKN", "NYK", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "OKC", "UTA", "WAS", "TOR", "MEM", "CHA"];
export const BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/";
// Custom team logos live here and only load with the league's login (see api/logo.js).
export const LOGO_HOST = "https://mystique-api.fantasy.espn.com/apis/v1/domains/lm/images/";
// ESPN account names that belong to someone else, and the short names the site uses.
const SAME_PERSON = { "harc bark": "Ben Einzig", "umar ahmad": "Mack Harris", "team 10": "Dean Bowie", "anthony grbic": "John Grbic" };
const SHORT = { "Matt Wolff": "Matt W", "Matthew Glickman": "Matt G", "Sam Resnick": "Sammy", "John Grbic": "Tony" };

export const connected = () => !!(process.env.ESPN_S2 && process.env.SWID && process.env.LEAGUE_ID);

const cookie = () => `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.SWID}`;

// `query` adds to the address (e.g. scoringPeriodId) and `filter` is ESPN's X-Fantasy-Filter.
export async function espn(year, views, { query = {}, filter } = {}) {
  const params = [...views.map(v => "view=" + v), ...Object.entries(query).map(([k, v]) => `${k}=${v}`)];
  const headers = { Cookie: cookie() };
  if (filter) headers["X-Fantasy-Filter"] = JSON.stringify(filter);
  const r = await fetch(`${BASE}${year}/segments/0/leagues/${process.env.LEAGUE_ID}?` + params.join("&"), { headers });
  if (!r.ok) throw new Error("ESPN answered " + r.status);
  return r.json();
}

// Every NBA team's games, by ESPN's day number (scoring period).
export async function nbaSchedule(year) {
  const r = await fetch(`${BASE}${year}?view=proTeamSchedules_wl`, { headers: { Cookie: cookie() } });
  if (!r.ok) throw new Error("ESPN answered " + r.status);
  return (await r.json()).settings.proTeams;
}

// Sends a roster move the way ESPN's own site does. Answers { ok, status, data } and leaves
// reading ESPN's reasons for a refusal to the caller.
export async function espnTransaction(year, body) {
  const r = await fetch(`https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/${year}/segments/0/leagues/${process.env.LEAGUE_ID}/transactions/`, {
    method: "POST",
    headers: { Cookie: cookie(), "Content-Type": "application/json", "X-Fantasy-Platform": "espn-fantasy-web" },
    body: JSON.stringify({ ...body, memberId: process.env.SWID }),
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
}

function ownerName(member) {
  if (!member) return "";
  const full = `${member.firstName || ""} ${member.lastName || ""}`.trim();
  const real = SAME_PERSON[full.toLowerCase()] || full;
  return SHORT[real] || real.split(" ")[0];
}

// Team id -> the owner's first name and the team's name. Nothing else about the owner leaves the server.
export function teamsOf(league) {
  const members = Object.fromEntries((league.members || []).map(m => [m.id, m]));
  return Object.fromEntries(league.teams.map(t => [t.id, {
    id: t.id,
    owner: ownerName(members[(t.owners || [])[0]]) || t.abbrev,
    team: (t.name || `${t.location || ""} ${t.nickname || ""}`).replace(/\s+/g, " ").trim(),
  }]));
}
