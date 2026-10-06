import { isCommissioner } from "../lib/key.js";
import { matchName } from "../public/names.js";
import { loadResponse, saveResponse } from "../lib/responses.js";

// Commissioner only: drops the device lock on one person's picks so they can send them from a new device.
// Their saved picks stay until they are replaced.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (!isCommissioner(body.key)) return res.status(401).json({ error: "Bad key" });
  const { name } = matchName(body.name);
  const saved = name && await loadResponse(name);
  if (!saved) return res.status(404).json({ error: "No picks saved for that name" });
  const { lock, ...rest } = saved;
  await saveResponse({ ...rest, name });
  res.status(200).json({ ok: true });
}
