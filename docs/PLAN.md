# STARS — Plan & Roadmap

## Vision

Fly through the galaxy, not look at it from Earth. Real stars at true 3D positions
with real velocity vectors, SketchUp-style navigation (orbit/pan/zoom), and
*instruments* rather than just a map:

- Measurement tethers: true 3D separation between any two stars
- Closure rates: closing/separating speed from full 6D velocity data
- Relativistic mission briefs: constant-1g brachistochrone (ship years, Earth years, peak β/γ)
- Intercept navigation: aim where a star will be, not where it is
- Deep-time scrubbing: ±100k years via real velocity vectors

**Design language:** "observatory brass" — near-black indigo space, amber accents
(`#e8b45a`), Georgia serif display type, monospace data readouts. Chart cartouche,
not game HUD.

**Honesty policy:** real data rendered as real; anything procedural (e.g. Milky Way
backdrop) is labeled as such.

## Coordinate & data conventions

- Sun at origin; 1 scene unit = 1 light-year
- Galactic frame: scene X → galactic center, scene Y → north galactic pole,
  scene Z = −(galactic Y) — right-handed, matches `prototype/stellar_atlas.jsx`
- Equatorial→galactic via the standard J2000 rotation matrix (see prototype `EQ2GAL`)
- Three.js r128 pattern with a **custom orbit implementation** (no OrbitControls) — keep it
- Physics constants: c = 299,792.458 km/s; 1 g = 1.03228 ly/yr²

## Stages

### S0 — Repo bootstrap ✅
Repo at `mbroadfo/stars` (private): `prototype/`, `pipeline/`, `web/`, `docs/`.
Prototype moved in as design reference. Gate: pushed; raw README resolves.

### S1 — Tier 1 data pipeline
Source: AT-HYG v3.2 (`athyg_v32-1.csv.gz` + `athyg_v32-2.csv.gz`; **part 2 has no
header row** — reuse part 1's columns). Profile: 2,551,745 rows; 2,491,328 with full
6D (x0,y0,z0 + vx,vy,vz); 123,018 with 6D at mag ≤ 9.

`pipeline/build_tier1.py` (Python/pandas):
- Download → merge → cull to mag ≤ 9 AND full 6D
- Catalog positions are parsecs, equatorial frame → convert to ly, galactic scene frame;
  velocity vectors rotated into the same frame
- Pack little-endian Float32, 32 bytes/star: x,y,z (ly) · vx,vy,vz (km/s) · mag · colorIndex
- Sidecar `names.json` (proper names + spectral class), `manifest.json` (count, bytes, SHA-256)
- Deterministic output

Gate: round-trip test reloads the buffer, count ≈ 123,018 (document exact),
Sirius/Vega positions spot-checked against prototype values.

### S2 — Web viewer
`web/`: Vite + React + Three.js. Prototype promoted; star buffer fetched; shader
point rendering. Gate: 60 fps @ 123k stars.

### S3 — Deploy
S3 + CloudFront static hosting via GitHub Actions (same pattern as the Reef project).

### S4 — Time scrub
±100k years using velocity vectors. Gate: reproduce Barnard's Star closest approach
(~11.8k yr from now, ~3.75 ly).

### S5 ⭐ — Route planner
Multi-hop route planner with crew-age / Earth-calendar ledger + lead-pursuit
intercept solver (aim at future position).

### S6 — Full catalog
Go/no-go: octree streaming of the full 2.5M-star set.

### Backlog
- Radiosphere: 110 ly broadcast bubble vs. exoplanet systems
- Earth Transit Zone
- Gaia DR3 deep field

## Working agreements

- Commit early and often; push before session end (non-negotiable)
- PowerShell for anything run manually
- No GitHub API calls in tooling — `raw.githubusercontent.com` reads only
- Ask before adding dependencies beyond three, vite, pandas
