import { createHash } from "node:crypto";
import { loadResponses } from "../lib/responses.js";

// SHA-256 of the commissioner's results key. The key itself is not stored in the repo.
const KEY_HASH = "646fd7e84eb611e7c3975053fc8d9e5e0c5a230eaddfc2aab6397630082b050b";

export default async function handler(req, res) {
  const key = String(req.query.key || "");
  if (createHash("sha256").update(key).digest("hex") !== KEY_HASH) return res.status(401).json({ error: "Bad key" });
  const responses = await loadResponses();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ responses: responses.sort((a, b) => a.name.localeCompare(b.name)) });
}
