import { list, put } from "@vercel/blob";

// The weekly newsletter. Vercel calls this every morning (see vercel.json). It emails the newest
// finished week once that week's written recap is on the site, and only once per week.
// The member list lives in Vercel's private settings as NEWSLETTER_TO: the first address is
// Matt's, which goes in To and gets the replies; everyone else is on BCC.
// ?test=1 sends a copy to Matt only (and ?week=N picks the week), without counting as sent.
// ?redraw=1 asks OpenAI for a new cover instead of reusing the week's saved one.
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

  const art = await cover(weekly.year, week, recap.email?.cover, hub, q.get("redraw") === "1").catch(e => ({ why: e.message }));
  const [to, ...bcc] = NEWSLETTER_TO.split(",").map(s => s.trim()).filter(Boolean);
  const email = build(weekly, recap, hub, art.url);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", ...(test ? {} : { "Idempotency-Key": `newsletter-${weekly.year}-week-${week}` }) },
    body: JSON.stringify({ from: FROM, to: [to], bcc: test ? [] : bcc, reply_to: to, subject: (test ? "[Test] " : "") + email.subject, html: email.html, text: email.text }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(502).json({ sent: false, why: out.message || "Resend refused the email." });
  if (!test) await put(marker, JSON.stringify({ week, sentAt: new Date().toISOString(), id: out.id, recipients: 1 + bcc.length, cover: art.url || null }),
    { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  res.status(200).json({ sent: true, test, week, recipients: test ? 1 : 1 + bcc.length, id: out.id, cover: art.url || art.why });
}

// The week's comic-book cover. OpenAI draws it from the scene the Monday recap writes, using ESPN
// photos of the featured players and the featured teams' logos as reference pictures. Each drawing
// is saved under a new name, so a redraw never shows an old cached copy, and the newest one wins.
async function cover(year, week, c, hub, redraw) {
  const prefix = `newsletter/${year}/week-${week}-cover-`;
  if (!redraw) {
    const { blobs } = await list({ prefix });
    if (blobs.length) return { url: blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0].url };
  }
  if (!c?.scene) return { why: "The recap has no cover scene." };
  if (!process.env.OPENAI_API_KEY) return { why: "No OpenAI key." };

  const logos = Object.fromEntries((hub?.teams || []).map(t => [t.owner, t.logo]));
  const refs = (await Promise.all([
    ...(c.players || []).slice(0, 4).map(p => picture(`https://a.espncdn.com/i/headshots/nba/players/full/${p.id}.png`, `Photo of ${p.name}`)),
    ...(c.teams || []).slice(0, 4).map(owner => logos[owner] && picture(new URL(logos[owner], SITE).href, `Logo of ${owner}'s fantasy team`)),
  ])).filter(Boolean);
  const prompt = [
    `A comic-book cover for "Fantasy Hoops", a fantasy basketball league's weekly newsletter. Classic American comic cover style: bold ink lines, halftone dots, bright saturated colors, big dramatic action. A small "WEEK ${week}" badge sits in the top corner.`,
    c.title && `The cover headline, in big hand-lettered comic letters, reads exactly: "${c.title}"`,
    `Scene: ${c.scene}`,
    refs.length && "Reference images, in order:\n" + refs.map((r, i) => `${i + 1}. ${r.label}`).join("\n"),
    "Draw the players as fun cartoon caricatures that look like their photos, in their NBA team's colors. Show the fantasy team logos on banners, shields or jerseys. Keep every word short and spelled exactly as given. Landscape layout.",
  ].filter(Boolean).join("\n\n");

  const options = { model: "gpt-image-2.6-flare", prompt, size: "1536x1024", quality: "high", output_format: "jpeg", output_compression: 82 };
  let body = JSON.stringify(options), headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" };
  if (refs.length) {
    body = new FormData();
    for (const [k, v] of Object.entries(options)) body.set(k, v);
    refs.forEach((r, i) => body.append("image[]", r.blob, `ref-${i + 1}.${r.blob.type.split("/")[1]}`));
    delete headers["Content-Type"];
  }
  const r = await fetch(`https://api.openai.com/v1/images/${refs.length ? "edits" : "generations"}`, { method: "POST", headers, body });
  const out = await r.json().catch(() => ({}));
  const b64 = out.data?.[0]?.b64_json;
  if (!b64) return { why: out.error?.message || `OpenAI answered ${r.status}.` };
  const saved = await put(`${prefix}${Date.now()}.jpg`, Buffer.from(b64, "base64"), { access: "public", addRandomSuffix: false, contentType: "image/jpeg" });
  return { url: saved.url };
}

async function picture(url, label) {
  const r = await fetch(url).catch(() => null);
  const type = (r?.ok && r.headers.get("content-type") || "").replace("image/jpg", "image/jpeg");
  if (!/^image\/(png|jpeg|webp)/.test(type)) return null;
  return { label, blob: new Blob([await r.arrayBuffer()], { type: type.split(";")[0] }) };
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = n => typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(n);
const firstSentence = s => (String(s || "").match(/^.*?[.!?](?=\s|$)/) || [s || ""])[0];
const ORANGE = "#ff5a1f";
const IMPACT = "font-family:Impact,'Arial Narrow Bold',Helvetica,Arial,sans-serif;font-weight:normal";
const H2 = `font-size:22px;line-height:1.1;margin:32px 0 8px;text-transform:uppercase;letter-spacing:.01em;${IMPACT}`;
const TD = "padding:8px 0;border-top:1px solid #e5e5e5";
const NUM = `width:34px;padding:8px 0;border-top:1px solid #e5e5e5;vertical-align:top;font-size:20px;line-height:1.2;color:${ORANGE};${IMPACT}`;
const h2 = text => `<h2 style="${H2}">${esc(text)}</h2>`;
// The quick awards; the rest stay on the site.
const AWARDS = ["top", "low", "player", "lucky", "heartbreak", "bench", "waiver", "bust"];

// Bite-sized: the cover, a two-line hook, scores, fun facts, the Gauntlet, quick awards, one line
// per team and a teaser. The recap's `email` block holds the short versions; without it the long
// recap is trimmed instead.
function build(w, recap, hub, art) {
  const e = recap.email || {};
  const link = `${SITE}/recap.html?week=${w.week}`;
  const power = [...w.teams].sort((a, b) => a.powerRank - b.powerRank);
  const parts = [];
  parts.push(`<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${ORANGE};font-weight:bold;margin:0">Fantasy Hoops · ${esc(w.season)} · Week ${w.week}</p>`);
  parts.push(`<h1 style="font-size:34px;line-height:1.05;margin:8px 0 14px;text-transform:uppercase;${IMPACT}">${esc(recap.title)}</h1>`);
  if (art) parts.push(`<a href="${link}"><img src="${esc(art)}" width="600" alt="${esc(`Week ${w.week} cover: ${recap.title}`)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;margin:0 0 14px"></a>`);
  parts.push(`<p style="font-size:17px;margin:0 0 4px">${esc(e.hook || recap.intro)}</p>`);

  parts.push(h2("Scoreboard"));
  parts.push(`<table style="width:100%;border-collapse:collapse;font-size:15px">` + w.matchups.map(m => {
    const [win, lose] = m.winner === "AWAY" ? [m.away, m.home] : [m.home, m.away];
    return `<tr><td style="${TD}"><b>${esc(win.owner)}</b> ${fmt(win.points)}</td><td style="${TD};text-align:right;color:#666">${esc(lose.owner)} ${fmt(lose.points)}</td></tr>`;
  }).join("") + `</table>`);

  if (e.facts?.length) {
    parts.push(h2("Fun facts"));
    parts.push(`<table style="width:100%;border-collapse:collapse;font-size:15px">` + e.facts.map((f, i) =>
      `<tr><td style="${NUM}">${i + 1}</td><td style="${TD}">${esc(f)}</td></tr>`).join("") + `</table>`);
  }

  const g = hub?.gauntlet;
  if (g?.next && g.alive.length > 1) {
    const by = Object.fromEntries(hub.teams.map(t => [t.id, t])), alive = g.alive.map(id => by[id]), last = alive[0], next = alive[1];
    const days = g.next.daysLeft + 1;
    parts.push(h2("Gauntlet watch"));
    let line = `${last.owner} is last, ${fmt(Math.round((next.points - last.points) * 10) / 10)} behind ${next.owner}. Lowest season total on ${g.next.name} is out, ${days === 1 ? "1 day" : `${days} days`} to go.`;
    if (g.out.length) line += ` Already out: ${g.out.map(o => `${by[o.id].owner} (${o.cut})`).join(", ")}.`;
    parts.push(`<p style="font-size:15px;margin:0 0 10px">${esc(line)}</p>`);
    parts.push(`<table style="width:100%;border-collapse:collapse;font-size:15px">` + alive.slice(0, 3).map(t =>
      `<tr><td style="${TD}"><b style="color:${t === last ? "#c81e1e" : "#111"}">${esc(t.owner)}</b></td><td style="${TD};text-align:right">${fmt(t.points)}</td><td style="${TD};text-align:right;width:90px;color:${t === last ? "#c81e1e" : "#666"}">${t === last ? "last" : "+" + fmt(Math.round((t.points - last.points) * 10) / 10)}</td></tr>`).join("") + `</table>`);
    parts.push(`<p style="margin:10px 0 0;font-size:14px"><a href="${SITE}/gauntlet.html" style="color:${ORANGE};font-weight:bold">Watch the race</a></p>`);
  }

  const awards = AWARDS.map(k => w.awards.find(a => a.key === k)).filter(Boolean);
  parts.push(h2("Quick awards"));
  parts.push(`<table style="width:100%;border-collapse:collapse;font-size:14px">` + awards.map(a =>
    `<tr><td style="${TD};color:#777;width:36%;vertical-align:top">${esc(a.title)}</td><td style="${TD}"><b>${esc(a.owner)}</b> · ${esc(fmt(a.value))} · ${esc(a.detail)}</td></tr>`).join("") + `</table>`);

  parts.push(h2("Power rankings"));
  parts.push(`<table style="width:100%;border-collapse:collapse;font-size:15px">` + power.map(t => {
    const line = e.bites?.[t.owner] || firstSentence(recap.teams?.[t.owner]);
    return `<tr><td style="${NUM}">${t.powerRank}</td><td style="${TD}"><b>${esc(t.owner)}</b> <span style="color:#777">${t.record[0]}-${t.record[1]}</span>${line ? `<br>${esc(line)}` : ""}</td></tr>`;
  }).join("") + `</table>`);

  const teaser = e.teaser || recap.preview;
  if (teaser) {
    parts.push(h2(`Coming up: week ${w.week + 1}`));
    parts.push(`<p style="font-size:15px;margin:0">${esc(teaser)}</p>`);
  }
  parts.push(`<p style="margin:28px 0 0"><a href="${link}" style="display:inline-block;background:${ORANGE};color:#fff;padding:12px 20px;text-decoration:none;font-weight:bold;font-size:14px;letter-spacing:.06em;text-transform:uppercase">Read the full recap</a></p>`);
  parts.push(`<p style="font-size:13px;color:#777;border-top:1px solid #e5e5e5;padding-top:14px;margin-top:28px">Live scores, rankings and every record at <a href="${SITE}/" style="color:#111">fantasyhoops.fun</a>. Replies go to Matt.</p>`);

  const facts = (e.facts || []).map((f, i) => `${i + 1}. ${f}`).join("\n");
  return {
    subject: `Fantasy Hoops Week ${w.week}: ${recap.title}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;line-height:1.5">${parts.join("")}</div>`,
    text: `Fantasy Hoops, Week ${w.week}: ${recap.title}\n\n${e.hook || recap.intro}\n\n${facts ? `Fun facts\n${facts}\n\n` : ""}Full recap: ${link}`,
  };
}
