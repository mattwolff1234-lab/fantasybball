import { isCommissioner } from "../lib/key.js";
import { loadResponses } from "../lib/responses.js";

export default async function handler(req, res) {
  if (!isCommissioner(req.query.key)) return res.status(401).json({ error: "Bad key" });
  const responses = (await loadResponses()).map(({ lock, ...p }) => ({ ...p, locked: !!lock }));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ responses: responses.sort((a, b) => a.name.localeCompare(b.name)) });
}
