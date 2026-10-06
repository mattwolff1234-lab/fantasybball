import { matchName } from "../public/names.js";
import { loadResponses, saveResponse, lockFor } from "../lib/responses.js";

const SLOT = /^\d{4}-\d{2}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const typed = String(body.name || "").trim().slice(0, 24);
  const { name } = matchName(typed);
  const token = String(body.token || "");
  const slots = Array.isArray(body.slots) ? [...new Set(body.slots.filter(s => SLOT.test(s)))].slice(0, 60) : [];
  if (!typed) return res.status(400).json({ error: "Name is required" });
  if (!name) return res.status(400).json({ error: "That name isn't on the league list." });
  if (!slots.length) return res.status(400).json({ error: "Pick at least one time" });
  if (token.length < 16 || token.length > 64) return res.status(400).json({ error: "Reload the page and try again." });
  // First device to send picks for a name owns it; anyone else is turned away until the commissioner unlocks it.
  // A device also gets one name, so one person can't claim the whole league.
  const lock = lockFor(token), all = await loadResponses();
  const saved = all.find(p => p.name === name), other = all.find(p => p.name !== name && p.lock === lock);
  if (saved && saved.lock && saved.lock !== lock) return res.status(409).json({
    error: name + "'s picks were already sent from another device. Ask the commissioner to unlock them." });
  if (other) return res.status(409).json({
    error: "This device already sent picks as " + other.name + ". Ask the commissioner to unlock that name first." });
  await saveResponse({ name, slots, at: new Date().toISOString(), lock });
  res.status(200).json({ ok: true, name });
}
