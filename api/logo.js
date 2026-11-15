import { LOGO_HOST } from "../lib/espn.js";

// Custom team logos uploaded to ESPN only load for someone logged in, so the site fetches them
// with the league's login and passes the picture along. Only ESPN's league image ids are accepted.
export default async function handler(req, res) {
  const id = new URL(req.url, "http://x").searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).end();
  const { ESPN_S2, SWID } = process.env;
  const r = await fetch(LOGO_HOST + id, { headers: { Cookie: `espn_s2=${ESPN_S2}; SWID=${SWID}` } });
  if (!r.ok) return res.status(404).end();
  // An uploaded logo never changes: a new upload gets a new id.
  res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
  res.status(200).end(Buffer.from(await r.arrayBuffer()));
}
