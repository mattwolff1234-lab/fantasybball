// League roster: the only people whose picks count. Shared by the picker (browser) and the API.
// First entry is the name shown and saved; the rest are other spellings that mean the same person.
const ROSTER = [
  // Two Matts: plain "Matt" or "Matthew" belongs to both, so it never resolves and the picker asks which one.
  ["Matt W", "Matthew W", "Matt", "Matthew"],
  ["Matt G", "Matthew G", "Glickman", "Matt Glickman", "Matt", "Matthew"],
  ["Sammy", "Sam"],
  ["Dean"], ["Ben"], ["Karan"], ["Sean"], ["Max"], ["Mack"], ["Koren"],
];
export const NAMES = ROSTER.map(r => r[0]);
const norm = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const SPELLINGS = ROSTER.flatMap(r => r.map(s => ({ s: norm(s), name: r[0] })));

// Edit distance where two swapped letters count as one mistake.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

// Resolves what someone typed to a roster name. An exact match (any case) wins, unless two people share
// that spelling. Otherwise a typo is fixed only when exactly one person is closest; "Karen" could be Karan or Koren, so it comes back unresolved
// with both in `close`. Short names allow one mistake, longer ones two; a clear prefix ("Glick") also counts.
export function matchName(input) {
  const t = norm(input);
  if (!t) return { name: null, close: [] };
  const exact = SPELLINGS.filter(x => x.s === t).map(x => x.name);
  if (exact.length) return { name: exact.length === 1 ? exact[0] : null, close: exact };
  const near = SPELLINGS.map(x => ({ name: x.name, d: distance(t, x.s), max: x.s.length > 4 ? 2 : 1 })).filter(x => x.d <= x.max);
  const best = Math.min(...near.map(x => x.d));
  let close = [...new Set(near.filter(x => x.d === best).map(x => x.name))];
  if (!close.length && t.length >= 3) close = [...new Set(SPELLINGS.filter(x => x.s.startsWith(t)).map(x => x.name))];
  return { name: close.length === 1 ? close[0] : null, close };
}
