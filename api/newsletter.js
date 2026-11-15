import { list, put } from "@vercel/blob";

// The weekly newsletter. Vercel calls this every morning (see vercel.json). It emails the newest
// finished week once that week's written recap is on the site, and only once per week.
// The member list lives in Vercel's private settings as NEWSLETTER_TO: the first address is
// Matt's, which goes in To and gets the replies; everyone else is on BCC.
// ?test=1 sends a copy to Matt only (and ?week=N picks the week), without counting as sent.
const SITE = "https://www.fantasyhoops.fun";
const FROM = "Fantasy Hoops <newsletter@fantasyhoops.fun>";

export default async function handler(req, res) {
  const { CRON_SECRET, RESEND_API_KEY, NEWSLETTER_TO } = process.env;
  if (!CRON_SECRET || req.headers.authorization !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: "Not allowed." });
  const q = new URL(req.url, SITE).searchParams, test = q.get("test") === "1";
  const get = path => fetch(SITE + path, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);

  // The fresh= stamp skips the site's cache, which can hold an older week for up to a day.
  const weekly = await get(`/api/weekly?fresh=${Date.now()}` + (q.get("week") ? `&week=${Number(q.get("week"))}` : ""));
  if (!weekly?.final) return res.status(200).json({ sent: false, why: "No finished week to send." });
  const week = weekly.week, marker = `newsletter/${weekly.year}/week-${week}.json`;
  // Weeks 1-3 of this season were handled with Gmail drafts.
  if (!test && weekly.year === 2027 && week < 4) return res.status(200).json({ sent: false, why: `Week ${week} was a Gmail draft.` });
  if (!test) {
    const { blobs } = await list({ prefix: marker, limit: 1 });
    if (blobs.length) return res.status(200).json({ sent: false, why: `Week ${week} already went out.` });
  }
  const [recap, hub] = await Promise.all([get(`/recaps/${weekly.year}/week-${week}.json`), get("/api/hub")]);
  if (!recap) return res.status(200).json({ sent: false, why: `The week ${week} recap isn't on the site yet.` });

  const [to, ...bcc] = NEWSLETTER_TO.split(",").map(s => s.trim()).filter(Boolean);
  const email = build(weekly, recap, hub);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", ...(test ? {} : { "Idempotency-Key": `newsletter-${weekly.year}-week-${week}` }) },
    body: JSON.stringify({ from: FROM, to: [to], bcc: test ? [] : bcc, reply_to: to, subject: (test ? "[Test] " : "") + email.subject, html: email.html, text: email.text }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(502).json({ sent: false, why: out.message || "Resend refused the email." });
  if (!test) await put(marker, JSON.stringify({ week, sentAt: new Date().toISOString(), id: out.id, recipients: 1 + bcc.length }),
    { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  res.status(200).json({ sent: true, test, week, recipients: test ? 1 : 1 + bcc.length, id: out.id });
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = n => typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(n);
const ORANGE = "#ff5a1f";
const H2 = `font-size:22px;line-height:1.1;margin:32px 0 8px;text-transform:uppercase;letter-spacing:.01em;font-family:Impact,'Arial Narrow Bold',Helvetica,Arial,sans-serif;font-weight:normal`;
const TD = "padding:8px 0;border-top:1px solid #e5e5e5";
const h2 = text => `<h2 style="${H2}">${esc(text)}</h2>`;

// The same email the Monday drafts used to be, plus a Gauntlet section.
function build(w, recap, hub) {
  const link = `${SITE}/recap.html?week=${w.week}`;
  const power = [...w.teams].sort((a, b) => a.powerRank - b.powerRank);
  const parts = [];
  parts.push(`<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${ORANGE};font-weight:bold;margin:0">Fantasy Hoops · ${esc(w.season)} · Week ${w.week} recap</p>`);
  parts.push(`<h1 style="font-size:34px;line-height:1.05;margin:8px 0 12px;text-transform:uppercase;font-family:Impact,'Arial Narrow Bold',Helvetica,Arial,sans-serif;font-weight:normal">${esc(recap.title)}</h1>`);
  parts.push(`<p style="font-size:16px;margin:0 0 20px">${esc(recap.intro)}</p>`);
  parts.push(`<p style="margin:0 0 8px"><a href="${link}" style="display:inline-block;background:${ORANGE};color:#fff;padding:12px 20px;text-decoration:none;font-weight:bold;font-size:14px;letter-spacing:.06em;text-transform:uppercase">See the full recap</a></p>`);

  parts.push(h2("Scoreboard"));
  parts.push(`<table style="width:100%;border-collapse:collapse;font-size:15px">` + w.matchups.map(m => {
    const [win, lose] = m.winner === "AWAY" ? [m.away, m.home] : [m.home, m.away];
    return `<tr><td style="${TD}"><b>${esc(win.owner)}</b> ${fmt(win.points)}</td><td style="${TD};text-align:right;color:#666">${esc(lose.owner)} ${fmt(lose.points)}</td></tr>`;
  }).join("") + `</table>`);

  const g = hub?.gauntlet;
  if (g?.next && g.alive.length > 1) {
    const by = Object.fromEntries(hub.teams.map(t => [t.id, t])), alive = g.alive.map(id => by[id]), last = alive[0], next = alive[1];
    const days = g.next.daysLeft + 1;
    parts.push(h2("Gauntlet watch"));
    let line = `${last.owner} is in last place, ${fmt(Math.round((next.points - last.points) * 10) / 10)} points behind ${next.owner}. The lowest season total on ${g.next.name} is out, and there ${days === 1 ? "is 1 day" : `are ${days} days`} of games left before the cut.`;
    if (g.out.length) line += ` Already out: ${g.out.map(o => `${by[o.id].owner} (${o.cut})`).join(", ")}.`;
    parts.push(`<p style="font-size:15px;margin:0 0 10px">${esc(line)}</p>`);
    parts.push(`<table style="width:100%;border-collapse:collapse;font-size:15px">` + alive.slice(0, 3).map(t =>
      `<tr><td style="${TD}"><b style="color:${t === last ? "#c81e1e" : "#111"}">${esc(t.owner)}</b></td><td style="${TD};text-align:right">${fmt(t.points)}</td><td style="${TD};text-align:right;width:90px;color:${t === last ? "#c81e1e" : "#666"}">${t === last ? "last" : "+" + fmt(Math.round((t.points - last.points) * 10) / 10)}</td></tr>`).join("") + `</table>`);
    parts.push(`<p style="margin:10px 0 0;font-size:14px"><a href="${SITE}/gauntlet.html" style="color:${ORANGE};font-weight:bold">Watch the race</a></p>`);
  }

  parts.push(h2("Awards"));
  parts.push(`<table style="width:100%;border-collapse:collapse;font-size:14px">` + w.awards.map(a =>
    `<tr><td style="${TD};color:#777;width:36%;vertical-align:top">${esc(a.title)}</td><td style="${TD}"><b>${esc(a.owner)}</b> · ${esc(fmt(a.value))} · ${esc(a.detail)}</td></tr>`).join("") + `</table>`);

  parts.push(h2("Power rankings"));
  parts.push(`<ol style="padding-left:22px;margin:0;font-size:15px">` + power.map(t =>
    `<li style="padding:3px 0"><b>${esc(t.owner)}</b> <span style="color:#777">${t.record[0]}-${t.record[1]}</span></li>`).join("") + `</ol>`);

  const teams = power.filter(t => recap.teams?.[t.owner]);
  if (teams.length) {
    parts.push(h2("Team by team"));
    for (const t of teams) parts.push(`<p style="margin:0 0 14px;font-size:15px"><b>${esc(t.owner)}.</b> ${esc(recap.teams[t.owner])}</p>`);
  }
  if (recap.preview) {
    parts.push(h2(`Week ${w.week + 1}`));
    parts.push(`<p style="font-size:15px;margin:0 0 24px">${esc(recap.preview)}</p>`);
  }
  parts.push(`<p style="font-size:13px;color:#777;border-top:1px solid #e5e5e5;padding-top:14px;margin-top:28px">Every number, every team and live scores at <a href="${SITE}/" style="color:#111">fantasyhoops.fun</a>. Replies go to Matt.</p>`);

  return {
    subject: `Fantasy Hoops Week ${w.week}: ${recap.title}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;line-height:1.5">${parts.join("")}</div>`,
    text: `Fantasy Hoops, Week ${w.week} recap: ${recap.title}\n\n${recap.intro}\n\nFull recap: ${link}`,
  };
}
