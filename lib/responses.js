import { list, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { matchName } from "../public/names.js";

const path = name => `responses/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
// The ?v= gets past the blob CDN cache after someone re-confirms.
const read = async b => {
  const r = await fetch(b.url + "?v=" + new Date(b.uploadedAt).getTime(), { cache: "no-store" });
  return r.ok ? r.json() : null;
};

// Each person's picks are locked to the device that first sent them: the device keeps a random token,
// and only its hash is stored here.
export const lockFor = token => createHash("sha256").update(String(token)).digest("hex");

// Every saved response from someone on the roster, read fresh. One per person, newest wins.
export async function loadResponses() {
  const { blobs } = await list({ prefix: "responses/", limit: 1000 });
  const byName = {};
  (await Promise.all(blobs.map(read))).filter(Boolean).forEach(p => {
    const { name } = matchName(p.name);
    if (name && !(byName[name] && byName[name].at > p.at)) byName[name] = { ...p, name };
  });
  return Object.values(byName);
}

export async function loadResponse(name) {
  const { blobs } = await list({ prefix: path(name), limit: 1 });
  return blobs[0] ? read(blobs[0]) : null;
}

export function saveResponse(data) {
  return put(path(data.name), JSON.stringify(data), {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 60,
  });
}
