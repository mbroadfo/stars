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

### S1 — Tier 1 data pipeline ✅

Gate passed 2026-07-15: exactly **123,018** stars packed (3,936,576 bytes);
round-trip test verifies count/bytes/SHA-256; Sirius err 0.002 ly and Vega err
0.045 ly vs prototype. 426 named stars in `names.json`; 2,187 stars missing
color index (sentinel 99.0, see `manifest.json`).

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

### S2 — Web viewer ✅

Gate passed 2026-07-17: steady **60 fps @ 123,018 stars** (headless Chrome on the
RTX 4070, sampled in neighborhood and whole-galaxy views). Prototype promoted to
`web/` (Vite + React + Three.js, custom orbit kept, single interleaved-buffer draw
call, size from mag + color from B−V in shader). Instruments verified end-to-end:
Sirius→Vega tether = 33.17 ly, closing 17.5 km/s from **full 3D velocities** (the
prototype's radial-only caveat is gone), 1 g brief = 7 ship yr / 35.1 Earth yr /
γ 18.12. Picking and labels limited to named + mag ≤ 3 stars by design. Data served
from `web/public/data/` (gitignored) — `npm run sync-data` copies pipeline output.

`web/`: Vite + React + Three.js. Prototype promoted; star buffer fetched; shader
point rendering. Gate: 60 fps @ 123k stars.

### S3 — Deploy

S3 + CloudFront static hosting via GitHub Actions, adapted from the
[spa-on-aws](https://github.com/mbroadfo/spa-on-aws) template (static-only path:
no Lambda/API Gateway). Target: `https://stars.xaminisalamini.com` (Cloudflare
DNS, ACM cert), app `stars`, bucket `stars-assets`, region us-west-2.

Architecture decisions (first consumer of spa-on-aws):

- **S3 is the system of record for the star catalog; git for code.** The
  catalog is NOT committed — `devops-data.yml` rebuilds it from AT-HYG on the
  runner (deterministic, ~5 min), runs the S1 round-trip gate, and only on pass
  syncs to `s3://{bucket}/data/tier1/` + invalidates `/data/*`. Triggered
  manually or on `pipeline/**` changes. Scales unchanged to the S6 full catalog.
- `devops-frontend.yml` (on `web/**`) builds and syncs the app but excludes
  `data/*` from its `--delete` — the catalog survives frontend deploys.
- CloudFront gets a dedicated `/data/*` behavior: 1-day edge TTL (the buffer
  isn't content-hashed), refreshed by invalidation on data sync.
- **OIDC federation instead of stored AWS keys** (upgrade over the template's
  IAM-user pattern): workflows assume short-lived roles `stars-terraform`
  (scoped: state+assets S3, CloudFront, ACM — no AdministratorAccess) and
  `stars-ci` (assets sync + invalidation only), trust-pinned to
  `repo:mbroadfo/stars:ref:refs/heads/master`. Zero AWS credentials in GitHub
  Secrets. One-time setup: `scripts/bootstrap-oidc.ps1` (PowerShell, run under
  a temporary admin key) creates the state bucket, OIDC provider, both roles,
  and 7 GitHub Secrets (Cloudflare pair, GH token, TF config).

Gate: `https://stars.xaminisalamini.com` serves the atlas with the SHA-verified
catalog; a `git push` touching only `web/` redeploys without touching data.

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
