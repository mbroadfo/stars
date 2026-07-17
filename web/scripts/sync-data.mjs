// Copy the Tier 1 pipeline outputs into web/public/data/ so Vite can serve them.
// (public/data/ is gitignored; run `python pipeline/build_tier1.py` first.)
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../pipeline/data/tier1/", import.meta.url));
const dst = fileURLToPath(new URL("../public/data/tier1/", import.meta.url));

if (!existsSync(src)) {
  console.error(`missing ${src} — run: python pipeline/build_tier1.py`);
  process.exit(1);
}
cpSync(src, dst, { recursive: true });
console.log(`synced tier1 data -> ${dst}`);
