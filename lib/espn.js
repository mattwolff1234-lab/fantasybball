// Shared by the functions that read the league from ESPN. The league's login is kept in
// Vercel's settings (ESPN_S2, SWID, LEAGUE_ID) and never in the repo.
export const SEASON = 2027; // ESPN names a season by the year it ends in
export const POS = { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" };
export const NBA = ["", "ATL", "BOS", "NOP", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MIA", "MIL", "MIN", "BKN", "NYK", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "OKC", "UTA", "WAS", "TOR", "MEM", "CHA"];
export const BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/";
// ESPN account names that belong to someone else, and the short names the site uses.
const SAME_PERSON = { "harc bark": "Ben Einzig", "umar ahmad": "Mack Harris", "team 10": "Dean Bowie", "anthony grbic": "John Grbic" };
const SHORT = { "Matt Wolff": "Matt W", "Matthew Glickman": "Matt G", "Sam Resnick": "Sammy" };

export const connected = () => !!(process.env.ESPN_S2 && process.env.SWID && process.env.LEAGUE_ID);

export async function espn(year, views) {
  const { ESPN_S2, SWID, LEAGUE_ID } = process.env;
  const r = await fetch(`${BASE}${year}/segments/0/leagues/${LEAGUE_ID}?` + views.map(v => "view=" + v).join("&"), { headers: { Cookie: `espn_s2=${ESPN_S2}; SWID=${SWID}` } });
  if (!r.ok) throw new Error("ESPN answered " + r.status);
  return r.json();
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
