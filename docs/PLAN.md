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

### S3 — Deploy ✅

Gate passed 2026-07-18: **<https://stars.xaminisalamini.com>** serves the atlas;
the runner-rebuilt catalog is byte-identical to the S1 gate build (SHA e691f47b…),
proving pipeline determinism in production. Deploy learnings: new GitHub repos
issue **immutable OIDC sub claims** (`repo:owner@id/repo@id:…`) — trust policies
must match that form; and non-secret config must live in GitHub *Variables*, not
Secrets, or output masking silently breaks job outputs containing those strings.
Only 2 secrets remain (Cloudflare token, GH token) — zero AWS credentials stored.

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

### S4 — Time scrub ✅

Gate passed 2026-08-04, on branch `s4-time-scrub`, riding S4.5's "watch the sky
change" machinery exactly as planned (positions advanced by v·t instead of the
camera moving). ±100,000 years, atlas view only (ship view always shows the
present — combining travel-time with time-scrub epochs is real but explicitly
deferred, not needed for this gate).

**Gate correction — the plan's own star wasn't in the data.** Barnard's Star
has apparent mag 9.51, fainter than Tier 1's mag ≤ 9 cutoff — it was never in
the 123,018-star buffer, so the original gate (~11.8k yr, ~3.75 ly) could not
be reproduced with real data. Rather than fudge it, computed closest-approach
against every named star actually in Tier 1 and substituted the real
answer: **Alpha Centauri (Rigil Kentaurus) — closest approach 2.871 ly in
27,610 years** — a genuine, independently-documented astronomical fact,
arguably a better demo star than Barnard's Star since it's the one everyone's
heard of. Verified live: selecting it shows the fact with a "jump" button;
jumping lands the epoch at T+27,610 yr and the live distance readout reads
2.9 ly, matching the closed-form minimum to rounding.

**What moves and what doesn't (honesty policy):** only Tier 1 stars advance,
on their real 6D velocities — shader-side (`uYears` uniform + `vel` attribute
on both the star points and the constellation-line endpoints, so asterisms
deform right along with the stars they connect) and JS-side (picking,
box-select, labels, halos, tether, the mission brief) all read the same
`years` state. Far-field (no velocity data) and the Sun (reference origin by
definition) stay fixed — stated outright in the credits line, not left
implicit.

**Instruments:** TIME control in the right rail (slider, now/±100k presets,
play at 2,500 yr/sec — a full sweep takes 80s); any selected star's card
shows its closest approach as a fixed trajectory fact (computed at t=0,
independent of the scrub position) with a one-click jump to that epoch;
two-star separation/closure in the mission brief is fully time-aware (Sirius
→ Vega: 33.17 ly now, 30.57 ly at +50,000 yr).

### S4.5 ⭐ — The Traveler's Sky (in progress; build BEFORE S4)

**Shipped 2026-07-19 — tests 1 + 2 live in production:** asterism lines
(123 lines / 23 constellations, hand-curated license-clean, all endpoints
resolved against AT-HYG con+bayer incl. hyphenated double-star suffixes);
ship view from the Sun (look-around, FOV zoom, target reticle + offscreen
arrow); trip engine (Start trip → play/pause/scrub a brachistochrone with
live ship-time/Earth-time/β/γ instruments; GPU-computed apparent magnitudes
from the ship's position; Sun marker carries real absmag 4.83). Verified:
midpoint Sun→Vega reads 3.2 ship yr / 13.5 Earth yr / 99.742% c / γ 13.93;
Lyra deforms and sheds Vega on arrival.

**Shipped 2026-07-24 — origin-aware ship view + persistent action rail:**
ship view and trips now depart from the actual selected ORIGIN (the Sun by
default, or star A once two stars are picked), not always the Sun —
`enterShip`/`startTrip` and the sky-filter shaders take the origin's real
position; the origin star's own point and name label are suppressed while
standing on it (mirrors the existing Sun-label treatment). Swap
origin/destination works any time in ship view, including mid-trip playing
or paused — it flips `trip.from`/`to` and mirrors `frac → 1-frac`, landing
on the identical position and γ (the brachistochrone profile is symmetric
around its midpoint, so this is a relabeling, not a physical jump). All
action buttons moved out of the left console (now pure telemetry) into a
persistent right action rail — VIEW / SELECTION / ACCELERATION / TRIP —
that stays visible regardless of what's expanded below, fixing buttons
that were getting buried under scrollable content. NAKED EYE / RANGE GATE
sky filters now also work in atlas (god) view, measured from the Sun
(real catalog magnitude + `dSun`) since there's no single vantage point
while free-orbiting. Zoom presets (Neighborhood/Bright stars/Whole galaxy)
highlight by live camera distance instead of never indicating the current
view. First-run help is now a centered dismissible overlay instead of a
top-right panel that collided with the new rail.

**Shipped 2026-08-06 — combined time+space travel + swap-with-Sun fix:**
one unified epoch now drives everything — `s.effYears = baseEpoch +
(active trip's Earth-time elapsed)`, computed once per frame and read by
the shader, picking, labels, the reticle, and the mission brief alike, in
both atlas and ship view. Concretely: scrub the TIME slider in ship view
before departing to set your *departure* epoch (previously forced to 0);
once you `Start trip`, the epoch advances automatically on Earth-time
(not ship-time — that's the physically correct clock, since relativity
dilates the crew's clock, not the universe's) while the manual
slider/play controls disable in favor of a live read-only readout; landing
(`Back to atlas`) bakes the elapsed epoch into the base scrub value, so
"the universe moved on while you were away" is where you land, not just a
mission-brief number — the next departure continues from there. Verified:
mid-flight epoch tracks Earth-time exactly (T+5,000 departure + 3 Earth-yr
elapsed at 7.5% distance into a 1g Sun→Vega leg — small because early
brachistochrone distance-vs-time is highly nonlinear, not a bug); full-trip
arrival reads T+27 yr, matching the mission brief's known 26.9 Earth-year
total. Ships fly a *fixed* two-point line captured at departure — a
destination's own rendered point can drift from that fixed line over long
/ fast-moving trips, which is honest (real interstellar flight has exactly
this problem) and exactly why intercept navigation is its own S5 feature,
not folded in here. Also fixed: swap was unreachable whenever the Sun was
the *implicit* (unselected) origin — single-star selection never puts the
Sun in `selected`, so the button's `A && B` visibility check was always
false for the single-star case, even though ship view always has a
well-defined Sun-or-star origin and destination. Swap's `onClick` now
promotes the implicit Sun to the explicit `SUN_IDX` slot on click, so
"Vega → Sun" (fly home) is one click away from a single-star pick, not
walled off behind a manual Sun search first.

Remaining: aberration/Doppler toggle (phase 2), label-collision +
core-blowout polish, click-anything identity cards, origin/destination
name search (autocomplete over named + designated stars, with "Sun" as a
permanent selectable entry — also closes the gap where the Sun can't be
picked once two real stars are already selected), a mobile pass
(look-around doesn't work mid-trip on mobile; trip controls are hard to
reach/see), and a lines category filter (zodiac/circumpolar/etc. —
deferred, no data model for it yet and "circumpolar" doesn't generalize
cleanly now that ship view isn't Earth-locked).

Pick two stars, press **Start Trip**, and ride a relativistic brachistochrone
while the constellations deform, dissolve, and reassemble around you.

**Core insight (why this is cheap):** every star already sits at its true 3D
position, so a planetarium is just the camera placed AT the ship looking
outward — and constellation lines drawn between real stars deform
automatically under perspective as the ship moves. No simulation, no per-frame
updates; the data does all the work.

**Experience flow:** select a destination (Sun is the implicit origin), or
select two stars to depart from the first — Ship view button (constellations
drawn, looking outward from the origin) → Start Trip → play/scrub a timeline
along the route at 0.5/1/2 g while instruments tick ship time, Earth time,
β, γ → arrival shows the destination's sky, with the origin faded to an
ordinary star (the Sun included, once you've left it).

**Data groundwork (pipeline):**

- `tier1_ids.bin`: uint32 ×3 per star — AT-HYG id, HIP (0 = none),
  constellation index. Probed: HIP covers 83,268 of tier1 and **516/516 of
  mag ≤ 4** (every possible line anchor); `con` covers 100% of tier1.
- `tier2_ids.bin`: uint32 ×1 — AT-HYG id (far field is Tycho/Gaia territory;
  cards show "AT-HYG #n").
- `desig.json`: Bayer (1,522) / Flamsteed (2,724) designations for tier1.
- `asterisms.json`: constellation line segments as pairs of tier1 buffer
  indices, resolved from HIP at build time. Source dataset must be
  license-vetted (Stellarium skyculture data is GPL — prefer BSD/MIT-licensed
  line sets or hand-curate ~25 major constellations from IAU/HIP tables).
- Constellation code table goes in `manifest.json`; gate test extended.

**Physics (lib/physics.js):**

- Absolute magnitude in-shader from packed apparent mag:
  `M = m − 5·log10(d_sun_pc / 10)` (tier2 already ships absmag).
- Apparent magnitude from the ship: `m' = M + 5·log10(d_ship_pc / 10)` —
  per-vertex; stars genuinely brighten ahead and fade behind.
- `brachAt(D, a, f)` — waypoint state at fraction f of a brachistochrone:
  accel half X = 1 + a·x → γ = X, β = √(X²−1)/X, τ = acosh(X)/a,
  t = √(X²−1)/a; mirrored for the decel half.
- Phase 2 (toggle, labeled): relativistic aberration
  cos θ' = (cos θ − β)/(1 − β·cos θ) and Doppler recoloring.

**Viewer:** mode `atlas | ship`; mouse-look + FOV zoom in ship view;
constellation LineSegments layer visible in both modes; Start Trip button in
the right action rail's TRIP group; timeline with play/pause/scrub. Riders
while in these files: label collision handling at shallow view angles,
zoom-dependent core brightness attenuation, click-anything identity cards
(uses the ids buffers).

**Gates:**

1. Planetarium fidelity — from the Sun, Orion / Ursa Major / Cassiopeia match
   real star-chart geometry; every line endpoint is a measured catalog star.
2. Sky deformation — Sun→Vega at 1 g: Sirius and Procyon visibly displaced by
   mid-trip; at arrival Vega dominates the sky (~mag −8) and the Sun has faded
   to naked-eye threshold, computed ≈ **mag +4.3** (absmag 4.83 at 7.68 pc).
3. Performance — 60 fps in ship view with lines + both star tiers.
4. Honesty — nothing procedural in the sky; relativistic toggles labeled.

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
