import { list } from "@vercel/blob";
import { createHash } from "node:crypto";

// SHA-256 of the commissioner's results key. The key itself is not stored in the repo.
const KEY_HASH = "646fd7e84eb611e7c3975053fc8d9e5e0c5a230eaddfc2aab6397630082b050b";

export default async function handler(req, res) {
  const key = String(req.query.key || "");
  if (createHash("sha256").update(key).digest("hex") !== KEY_HASH) return res.status(401).json({ error: "Bad key" });
  const { blobs } = await list({ prefix: "responses/", limit: 1000 });
  const responses = await Promise.all(blobs.map(async b => {
    const r = await fetch(b.url + "?v=" + new Date(b.uploadedAt).getTime(), { cache: "no-store" });
    return r.ok ? r.json() : null;
  }));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ responses: responses.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)) });
}
