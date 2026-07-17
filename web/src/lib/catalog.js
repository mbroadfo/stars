// Tier 1 catalog loader. Buffer layout (see pipeline/build_tier1.py):
// little-endian float32 x8 per star — x,y,z (ly, scene frame) | vx,vy,vz (km/s,
// same frame) | mag | colorIndex (99.0 = missing). Scene frame: Sun at origin,
// X -> galactic center, Y -> north galactic pole, Z = -galactic_y, 1 unit = 1 ly.

export const STRIDE = 8;
export const CI_SENTINEL = 50.0; // treat ci above this as "missing"

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

export async function loadCatalog(base = "/data/tier1") {
  const [manifest, names] = await Promise.all([
    fetchJson(`${base}/manifest.json`),
    fetchJson(`${base}/names.json`),
  ]);
  const r = await fetch(`${base}/tier1.bin`);
  if (!r.ok) throw new Error(`${base}/tier1.bin: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();

  if (buf.byteLength !== manifest.bytes)
    throw new Error(`tier1.bin byte length ${buf.byteLength} != manifest ${manifest.bytes}`);
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== manifest.sha256) throw new Error("tier1.bin SHA-256 mismatch vs manifest");
  }

  const data = new Float32Array(buf);
  const count = manifest.count;

  // names.json: { "<row index>": { name, spect } }
  const nameByIndex = new Map();
  for (const [k, v] of Object.entries(names)) nameByIndex.set(Number(k), v);

  return { data, count, manifest, nameByIndex };
}

// Lightweight per-star accessor (allocation-free callers can use raw `data`).
export function getStar(cat, i) {
  const o = i * STRIDE;
  const d = cat.data;
  const x = d[o], y = d[o + 1], z = d[o + 2];
  const vx = d[o + 3], vy = d[o + 4], vz = d[o + 5];
  const ly = Math.hypot(x, y, z);
  const named = cat.nameByIndex.get(i);
  return {
    i,
    x, y, z, vx, vy, vz,
    mag: d[o + 6],
    ci: d[o + 7],
    ly,
    // Heliocentric radial velocity: v · unit(pos). Negative = approaching.
    rv: ly > 0 ? (vx * x + vy * y + vz * z) / ly : 0,
    name: named?.name ?? null,
    spect: named?.spect ?? null,
  };
}
