import { list } from "@vercel/blob";

// Every saved response, read fresh. The ?v= gets past the blob CDN cache after someone re-confirms.
export async function loadResponses() {
  const { blobs } = await list({ prefix: "responses/", limit: 1000 });
  const responses = await Promise.all(blobs.map(async b => {
    const r = await fetch(b.url + "?v=" + new Date(b.uploadedAt).getTime(), { cache: "no-store" });
    return r.ok ? r.json() : null;
  }));
  return responses.filter(Boolean);
}
