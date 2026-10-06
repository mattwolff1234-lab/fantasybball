import { createHash } from "node:crypto";

// SHA-256 of the commissioner's results key. The key itself is not stored in the repo.
const KEY_HASH = "646fd7e84eb611e7c3975053fc8d9e5e0c5a230eaddfc2aab6397630082b050b";

export const isCommissioner = key => createHash("sha256").update(String(key || "")).digest("hex") === KEY_HASH;
