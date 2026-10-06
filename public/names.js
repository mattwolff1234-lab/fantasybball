// League roster: the only names that count. Shared by the picker (browser) and the API.
export const NAMES = ["Matt", "Glickman", "Mack", "Ben", "Koren", "Sammy", "Sean", "Karan", "Max", "Dean", "Matthew", "Sam"];

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

// Resolves what someone typed to a roster name. An exact match (any case) wins. Otherwise a typo is fixed
// only when exactly one name is closest; "Karen" could be Karan or Koren, so it comes back unresolved
// with both in `close`. Short names allow one mistake, longer ones two; a clear prefix ("Glick") also counts.
export function matchName(input) {
  const t = String(input || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return { name: null, close: [] };
  const exact = NAMES.find(n => n.toLowerCase() === t);
  if (exact) return { name: exact, close: [exact] };
  const near = NAMES.map(n => ({ n, d: distance(t, n.toLowerCase()) })).filter(x => x.d <= (x.n.length > 4 ? 2 : 1));
  const best = Math.min(...near.map(x => x.d));
  let close = near.filter(x => x.d === best).map(x => x.n);
  if (!close.length && t.length >= 3) close = NAMES.filter(n => n.toLowerCase().startsWith(t));
  return { name: close.length === 1 ? close[0] : null, close };
}
