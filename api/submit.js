import { put } from "@vercel/blob";
import { matchName } from "../public/names.js";

const SLOT = /^\d{4}-\d{2}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const typed = String(body.name || "").trim().slice(0, 24);
  const { name } = matchName(typed);
  const slots = Array.isArray(body.slots) ? [...new Set(body.slots.filter(s => SLOT.test(s)))].slice(0, 60) : [];
  if (!typed) return res.status(400).json({ error: "Name is required" });
  if (!name) return res.status(400).json({ error: "That name isn't on the league list." });
  if (!slots.length) return res.status(400).json({ error: "Pick at least one time" });
  await put(`responses/${name.toLowerCase()}.json`, JSON.stringify({ name, slots, at: new Date().toISOString() }), {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 60,
  });
  res.status(200).json({ ok: true, name });
}
