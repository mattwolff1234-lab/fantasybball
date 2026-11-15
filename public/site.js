// Shared by every page: each team's colour, and the live scores along the top. The home page
// reuses the same ESPN read through window.hub, so it isn't fetched twice.
const TEAM_COLORS = { 1: "#3b6fd8", 2: "#e9c46a", 3: "#8b6cff", 5: "#f58981", 6: "#a86030", 7: "#f07800", 8: "#3aa7e8", 9: "#b08a3e", 10: "#2bb673", 11: "#f15e60" };
window.teamColor = id => TEAM_COLORS[id] || "#4a4e5a";
window.fmt = n => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
window.hub = fetch("/api/hub").then(r => r.ok ? r.json() : null).catch(() => null);

window.hub.then(d => {
  const bar = document.getElementById("ticker");
  if (!d || !bar || !d.games.length) return;
  const by = Object.fromEntries(d.teams.map(t => [t.id, t]));
  const live = document.createElement("span");
  live.className = "live";
  live.textContent = d.games.every(g => g.final) ? `Week ${d.week} final` : `Week ${d.week} live`;
  bar.append(live);
  for (const g of d.games) {
    const a = document.createElement("a");
    a.href = "/";
    for (const s of [g.home, g.away].sort((x, y) => y.score - x.score)) {
      const span = document.createElement("span");
      span.textContent = `${by[s.id]?.owner || "?"} ${fmt(s.score)}`;
      a.append(span);
    }
    a.firstChild.className = "up";
    bar.append(a);
  }
  bar.hidden = false;
});
