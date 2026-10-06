import { loadResponses } from "../lib/responses.js";

// Public tally shown after someone confirms: how many teams picked each time. No names.
export default async function handler(req, res) {
  const responses = await loadResponses();
  const counts = {};
  responses.forEach(p => p.slots.forEach(s => counts[s] = (counts[s] || 0) + 1));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ teams: responses.length, counts });
}
