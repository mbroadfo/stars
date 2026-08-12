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

**S0–S4.6 built the map and the first instruments. S5–S6 build the reasons
this app exists nowhere else**: ways of *seeing* relativity, and ways of
*inhabiting* the catalog — as a plague, as a fiction, as a traveler's
compressed lifetime. The emotional target, always: the user should
periodically stop and say "wait — that's REAL?" Every feature is in service
of that moment.

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
  manually or on `pipeline/**` changes. Scales unchanged to the S7 full catalog.
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
this problem) and exactly why intercept navigation is its own deferred
feature (see Backlog), not folded in here. Also fixed: swap was unreachable whenever the Sun was
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

### S5 ⭐ — Seeing Relativity (tests 1 + 2 shipped)

Two live, navigable renders of what the mission brief has only ever reported
as numbers. Inspired by Overview Effekt's "Time Dilation Visualized" (the
original spark for this whole app), which showed both as canned animation —
we make both real and flyable.

**Shipped 2026-08-06 — Test 1, the Orange Tube.** Custom swept-circle mesh
(48 segments × 12 radial, `buildGammaTube` in `App.jsx`) along the
mission-brief's straight-line path, rebuilt on selection/accel change (not a
per-frame cost — this is a ~600-vertex mesh, not the 268k-point star field).
Radius `r(f) = rMin + (rMax-rMin)/gamma(f)`, color lerps amber → white-hot by
normalized γ; both endpoints exactly γ=1 by construction. Atlas view only —
hides in ship view (confirmed: Orion's lines and the Betelgeuse reticle
render with zero trace of the tube). **Gate 1 verified**: γ at f=0/0.5/1
matches `brachAt` exactly, by construction — the geometry calls `brachAt`
directly, no parallel formula to drift out of sync. **Gate 2 computed before
being asserted** (own working agreement, re-applied): Sol→Rigil Kentaurus
(4.32 ly, 1g) never crosses γ>5 (peak γ 3.23, 0% of ship-time) — Sol→
Betelgeuse (497.9 ly, 1g) spends **63.85%** of its 12.1 ship-years above that
threshold (peak γ 258.01) while costing only ~3.4× the ship-years for 115×
the distance, matching the textbook logarithmic-compression claim with room
to spare. Visually confirmed at both extremes: zoomed into the Sun end of
the short Rigil Kentaurus tube shows an unmistakable wide venturi
cross-section; the Betelgeuse tube renders as a thin bright line end-to-end
at neighborhood zoom, as intended ("narrowed to a bright wire"). Honesty
line added to the credits: the γ→radius mapping is explicitly illustrative.

**Follow-up 2026-08-06 — ring placement fixed (user-caught).** Original
build placed the 48 rings at *equal steps of distance*, but γ grows so fast
under constant proper acceleration that ~96% of the entire radius taper
happens within the first 5% of the distance — uniform-in-distance sampling
put only ~2 of 48 rings inside that transition, so it rendered as a faceted
cone welded to a cylinder, not a curve (correctly flagged as "not
relativistic" on sight, even though the underlying γ formula was never
wrong — the *tessellation* was). Fixed by placing rings at **equal steps of
ship-time** instead: physically meaningful (ship-time is what the crew
ages, already the app's own framing) rather than an arbitrary rendering
convenience, and it inverts to distance-fraction in closed form
(`shipYears = acosh(γ)/a` ⟺ `γ = cosh(a·t)`, `f = (γ−1)/(a·D)` — no
numerical root-finding). Verified numerically: the largest single
ring-to-ring radius jump for the Betelgeuse tube dropped from what would
have been a ~91% collapse in one step under the old sampling to **11.9%**
under the new one; the profile now descends in smooth small increments
(100%→16%→12%→10%→9%→8.6%→8.4% of rMax from f=0 to f=0.5).

**Follow-up 2026-08-07 — whole-ship-year rings (user's idea).** A bright
ring drawn around the tube at every whole ship-year, reusing the same
closed-form γ↔f inversion already built for ring placement. Not just
decoration — the *spacing* between consecutive year-rings visualizes time
dilation directly: for Sol→Betelgeuse the gap between year 1→2 is 2.35 ly,
widening to **168.86 ly** between years 6→7 (right around peak γ), then
narrowing back to 0.69 ly between years 11→12 near arrival — a crew-year
stops mapping to meaningful distance once you're deep in relativistic
territory, and the rings show that as a visible spacing pattern rather
than a number to read off the mission brief. Visually confirmed: an
ICE-colored ring crosses the Sirius tube at roughly its expected f≈0.34
(year 2 of 4). Credits line updated: "the rings around it mark whole
ship-years — their spacing, not their size, is the point."

**Shipped 2026-08-08 — Test 2, Travel-Time View.** A third atlas
projection: every star's position slides along its existing sight-line
(angular position from the origin never changes — from the origin's own
viewpoint the constellations look identical) until its radial distance
equals ship-years to reach it at the current accel, via a new `uMorph`
uniform blending `position` toward `direction * travelYears` in both star
shaders (tier1 and the shared absmag material for tier2 + the Sun marker).
Applies to **both** tiers — travel-time only needs distance, not velocity,
so Tier 2's 145,128 far-field stars (no 6D data) participate too, unlike
S4's time-scrub which is Tier-1-only. `travelYears` is precomputed once per
accel change (268,146 `journey().shipYears` calls — too expensive per-vertex
per-frame) and uploaded as a `BufferAttribute`, mirroring `uYears`'s
displacement pattern.

**Gate 3 verified**: `computeTravelYears` calls the exact same `journey(d,
accel).shipYears` used to build the mission brief (`brief = journey(sepLy,
accel)`), with `d` for a single-star selection being the same heliocentric
distance as `sepLy` — a structural identity, not a coincidence to trust on
sight. Checked against a real pair, Sol→Sirius (8.6 ly, 1g): mission brief
reads **4.6 years** ship time / **10.4 years** Earth time; an independent
Node-side call to `journey(8.6, 1)` returns 4.6076 / 10.3578, matching to
displayed precision. **Gate 4 verified**: 60 fps sustained through a full
0→100% slider sweep at whole-galaxy framing (all 268,146 points, both
tiers) — confirmed both immediately after the sweep and on a 3-second
settled reading, so the number isn't a rolling-average artifact from the
preceding camera flight.

**Honesty, load-bearing.** Render-only transform — real physics (tether,
mission brief, closure, closest-approach) always reads real positions
regardless of which projection is on screen. Tether, Orange Tube, and
selection halos hide while morph is engaged (they're real-distance overlays
that would visually detach from the warped points); the same applies to the
galactic-landmark labels (Sgr A*, disk-edge, distance rings) since they're
literal light-year markers with no ship-years reading of their own.
Credits line updated: "Travel-Time View remaps radial distance to
ship-years at the current accel and never touches real positions used for
measurement." Combining Travel-Time View with time-scrub epochs stays
deferred (as already noted at S4) — two independent remaps of "where a star
is drawn" is a real feature, just not this one.

**Bug caught before shipping.** The first `pick()` implementation
destructured the morphed screen-space point as `const [px, py, pz] = ...`
inside the hit-test loop — shadowing the outer `px`/`py` (the click's own
pixel coordinates) used two lines later in `Math.hypot(sx - px, sy - py)`.
Selection silently stopped working entirely (not just under morph — at
`uMorph=0` too, since the shadow applies regardless of morph value).
Caught by a headless hover probe (cursor stayed "grab" everywhere near a
known star position) before merge, not by eyeballing a screenshot; fixed by
renaming the inner destructure to `mx, my, mz`.

At whole-galaxy framing with morph at 100%, the visual effect is dramatic
and correct: the entire 268k-point catalog — real space spanning tens of
thousands of light-years — collapses into a small central cluster, because
under constant 1g even a 50,000 ly trip only costs roughly a decade of ship
time. That collapse *is* the feature.

### S6 — Layers & Labs (shipped)

Shared infrastructure: **a spatial neighbor index over Tier 1** ("which
stars lie within R ly of X"). Built as a uniform 3D grid, fixed cell size
8 ly (the canonical astrophage range — doesn't need rebuilding when the hop-
range slider moves, only the number of cells scanned per query changes),
built once at catalog load in `lib/infection.js`'s `buildNeighborGrid`. Not
a k-d tree/octree (over-engineered at 123k stars; that's S7's problem at
2.5M) and not brute-force-per-query either — a grid is the right size tool
for this job.

**Shipped 2026-08-09 — The Infection Lab.** *Project Hail Mary*'s astrophage
spreads star-to-star with an 8 ly range; the source video *claims* that
range would consume the galaxy without ever testing it. Built to let the
user test it instead of animating the claim. Controls: hop range (ly),
transmission chance per hop, incubation time per hop, patient zero (search
or click any real star, via `⌖` pick-on-map armed against the existing
`pick()`/`onUp` flow). An independent-cascade BFS (`runOutbreak` in
`lib/infection.js`) assigns each newly-infected star a generation (shortest
infection-hop-count) and epoch (`generation × incubationYears`, exact since
incubation isn't itself randomized); a failed transmission roll doesn't
permanently immunize a star — a *different* already-infected neighbor can
still reach it later on its own turn, which falls out of "skip only if
already infected" with no extra bookkeeping. **The TIME panel's slider +
play/pause + presets were extracted into a shared `ScrubControl` component**
and reused verbatim for the epoch scrub, on its own independent axis (its
own `s.infectionEpoch`/`infectionEpochPlaying`, not `s.years`) — exactly the
"rather than building a second timeline control from scratch" instruction,
without the two axes' meanings colliding. Live stats: infected count/%,
generation, percolated-or-died (first-pass heuristic: >1% of Tier 1 infected
reads as percolated).

Visualization is a dedicated overlay (`infectionPoints` / `infectionLines`,
two new `THREE.Points`/`LineSegments` objects, not the shared star shaders)
with a `uEpoch`-discard reveal — the exact same pattern as `uYears`/`uMorph`
elsewhere — so cascade points brighten in white-hot on infection and cool to
red with age, and transmission edges draw in as the epoch scrub passes them.
**Gates verified**: stochasticity confirmed real, not cosmetic — 10 runs
from Sirius at the canonical 8 ly/70%/1 yr settings ranged 1–14 stars
infected (a genuinely sparse neighborhood: Sirius has exactly 3 Tier‑1
neighbors within 8 ly — Procyon, Ran, Kapteyn's Star); a 25-star sample of
named patient zeros at those same canonical settings **never once
percolated** — largest observed outbreak was 6 stars (0.005% of the
catalog), a real empirical answer (with the caveat that the sample was
drawn from named/prominent stars, not a uniform draw over all of Tier 1) to
a claim the film never tested. 60 fps sustained through release + full
epoch playback at a large cascade (Sirius, 20 ly/95%, 15,130 stars
infected/12.3% — percolated) at whole-neighborhood framing, verified both
immediately and after a multi-second settle (the initial ~18 fps reading
right after a large Release is a one-frame geometry-upload transient, same
class as the travel-morph transient in the S5 writeup, not a sustained
cost). Ship view hides the panel and both overlay objects; confirmed no
console/page errors across pick → configure → release → scrub → re-release.
This is a percolation laboratory wearing a sci-fi costume — both identities
stay visible, neither is hidden behind the other.

**Fixed 2026-08-09 — RANGE GATE / NAKED EYE now actually restrict labels
and clicking (user-caught, with a screenshot).** Both filters have applied
to the rendered star point since S2 via the shader's `SKY_FILTER` macro,
but two other channels that display a star never looked at them: HTML
labels and `pick()` (click/hover selection) read `skyMode`/`gateLy` not at
all, so a star faded to near-invisible by the gate was still fully named
and fully clickable — at a 10 ly gate, dozens of thousand-ly-away names
were still on screen. Fixed with a shared `skyFade()` JS helper that
mirrors `SKY_FILTER`'s math exactly (same smoothstep curve, same
`LOG10x5` constant, cross-referenced in comments so the two can't drift),
used by both the labels loop and `pick()`. The gate's shader curve floors
fade at 0.1 (deliberate — a point stays a faint presence past the gate,
not an erased hole) so labels/picking snap off at `fade < 0.15`, just above
that floor, rather than only at literal zero. `computeBoxSelect` stays
deliberately exempt — its own tooltip promises "every star in it, even
faint ones." Also added a `names on/off` toggle (VIEW panel, same pattern
as the existing `lines on/off`) for star labels specifically, independent
of the gate — landmark labels (Sun/Sgr A*/disk edge/rings) are unaffected.
Verified: at a 10 ly gate, far names (Vega, Arcturus) are gone and no
longer clickable while in-gate stars (Sirius, at the transition zone) stay
fully labeled and pickable; box-select still lists gated-out stars as
designed; behavior confirmed consistent in both atlas and ship view.

**Fixed 2026-08-10 — the Sun and Bayer-designated stars (e.g. Tau Ceti)
are now fully selectable (user-caught: "why can't I select Sol or find
Tau Ceti").** Two gaps, one root cause each. The Sun is a code-level
sentinel (`SUN_IDX = -1`), not a row in the Tier 1 buffer, so three
interaction paths that only ever iterate real catalog rows structurally
couldn't reach it: search only special-cased the literal word "Sun"
(never "Sol"), `pickable` never included it, and `computeBoxSelect` never
tested against it — the rendered Sun marker existed but nothing could
click it. Separately, ~3,300 real stars including Tau Ceti have no
IAU-approved proper name, only a Bayer designation ("Tau Cet") — that
data already existed in `desig.json` (generated by the pipeline for
asterism-line resolution) but `catalog.js` never loaded it, so the
frontend had no idea those designations existed. Fixed: `loadCatalog`
now fetches `desig.json` into a `desigByIndex` map; `getStar()` falls back
to the designation when there's no proper name, so every existing display
site (mission brief, ORIGIN/DESTINATION cards) picks it up automatically;
`StarSearch` searches both maps with a bidirectional per-token prefix
matcher (`"tau ceti".startsWith` doesn't match stored `"Tau Cet"`, but
`"ceti".startsWith("cet")` does — handles the genitive-vs-abbreviation
mismatch generally, not just for this one star) and accepts "Sol" as a
Sun alias; `pickable` and `pick()` gained the Sun as a screen-projected
candidate (respecting RANGE GATE distance, never NAKED EYE-filtered — the
Sun is definitionally always naked-eye visible); `computeBoxSelect` gained
the same Sun candidate plus the designation-name fallback.

**Also revised while in there**: `computeBoxSelect` now respects RANGE
GATE distance (previously fully exempt) while still deliberately ignoring
NAKED EYE magnitude — user's call: box-select should keep surfacing faint
stars, but not ones the gate has pushed out of range. Verified: a tight
box around the Sun at a 10 ly gate went from 58 results to 4 (Rigil
Kentaurus/Toliman, the Sun, Groombridge 34), with a mag-8.1 star still
present among them, confirming the magnitude exemption held while the
distance cutoff engaged.

**Fixed 2026-08-11 — search dropdowns gained keyboard navigation, and the
Sun is now a valid Infection Lab patient zero (both user-caught: "I can
type sun or tau cet into the search box for the infection lab but can't
select it or arrow to it").** `StarSearch` had zero keyboard handling —
mouse-click selection worked (verified in the PR above), but arrow keys
just moved the text cursor and Enter did nothing. Added a `highlighted`
index shared between mouse-hover and keyboard focus: ArrowUp/ArrowDown
move it (clamped, not wrapped), Enter picks the highlighted row or falls
back to the top result if none is highlighted yet, Escape closes. Second,
the Infection Lab's search box had `allowSun={false}` (an assumption that
astrophage wouldn't realistically start at the Sun) — user's call: allow
it. That required more than flipping the flag: `runOutbreak`'s BFS always
indexed straight into the Tier 1 buffer via the current node's catalog
index, but the Sun (`SUN_IDX = -1`) has no row there. `queryNeighbors`
split into a position-based `queryNeighborsAt` plus a thin index-based
wrapper; `runOutbreak` now takes an explicit `patientZeroPos` and only
uses the position-based query for the seed node (every subsequent queue
entry is always a real star, so the existing index path is untouched).
`App.jsx`'s geometry-building loop gained a `posOf(idx)` helper so both
the infected-points and cascade-edge buffers substitute `(0,0,0)` for the
Sun instead of indexing off the end of the catalog array. Verified: typed
"Tau Ceti", ArrowDown, Enter selected it with no mouse click; typed "Sun",
Enter alone (no arrow) fell back to the top result and selected it; a
20 ly/95% outbreak released from the Sun percolated to 15,146 stars
(12.31%) with the cascade visibly converging on the Sun's screen position,
no console errors.

**Shipped 2026-08-11 — Universes.** A curated catalog of sci-fi settings
mapped onto real stars — author/work, star mappings (fictional name ↔ real
star, each with a citation), and canon routes flown through the trip
engine. Two universes: Niven's Known Space (chosen because its
colonization era is genuine STL slowboats under constant acceleration —
*this app's own physics*) and *Project Hail Mary* itself (Tau Ceti, now
actually selectable after the previous two PRs this session).

**Content, verified before writing, not asserted from memory** (WebSearch,
not parametric recall — matching this project's own "never guess one in"
rule): Wunderland → Rigil Kentaurus (Alpha Centauri, ~4.3 ly; colonized
circa 2091 — Niven's text doesn't specify component A vs B), We Made It →
Procyon (~11.3 ly, named for a colony ship's crash landing), Jinx → Sirius,
Plateau → Tau Cet — all four confirmed via larryniven.fandom.com. Tau Ceti
for *Project Hail Mary* is the book's own real star, ~11.9 ly, confirmed
via space.com's Andy Weir interview. **Deliberately did not fabricate a
multi-hop "grand tour" route**: colonization used independent one-way
slowboats to each destination, not a single ship hopping between systems —
no source supports a genuine multi-stop canon voyage here, so every
shipped route is a real, honest single leg (Sol→Wunderland, Sol→We Made
It, Sol→Jinx, Sol→Plateau, Sol→Tau Ceti).

**The multi-leg trip engine got built anyway** (per working-agreement:
infrastructure now, content when it exists) — `s.startRoute`/
`s.continueRoute` in App.jsx chain N-1 single-leg trips across N stops as a
thin wrapper around the *existing*, unmodified single-leg `s.trip` (a
plain SELECTION-panel trip is provably untouched — verified byte-for-byte
identical instrument-bar behavior with no route active). Each leg requires
an explicit "Continue to X" action on arrival (same explicit-departure UX
as the original "Start trip" button, not an auto-advance), baking the
finished leg's `journey()` totals into a running ship/Earth-years ledger.
**Gate verified** with a temporary (not shipped) synthetic 3-stop test
route, Sol→Sirius→Procyon: leg totals 4.61/10.36 and 3.85/6.93 ship/Earth
years (independently computed via `journey()` in Node) summed to
8.46/17.29, matching the in-app ledger's displayed 8.5/17.3 exactly.
`s.exitShip()` correctly bakes the *route's* cumulative Earth-years (not
just the current leg's) into the base epoch on landing — confirmed via a
real single-leg route (Sol→Wunderland, 4.32 ly): ship 3.6 / Earth 6.0
years, landing epoch read back as T+6 yr.

Star mappings resolve by **name/designation, not raw catalog index**
(`lib/universes.js`) — indices aren't stable across a `tier1.bin` rebuild,
names are — reusing `cat.nameByIndex`/`cat.desigByIndex` from the Sun/
Tau-Ceti-selection PR earlier this session. `SUN_IDX` moved from a local
App.jsx const to a `catalog.js` export so `universes.js` could share it
without a circular import. An unresolvable mapping renders a visible
"unresolved ⚠" in the UNIVERSES panel instead of being silently dropped —
verified with a temporary bad mapping before removing it.

**Redesigned 2026-08-11 — connected tubes + interactive Known Space
builder (user feedback after using the shipped panel: too much always-
visible citation text, and the four Known Space routes should be one
buildable route, not four separate buttons).** `buildGammaTube` (the S5
Orange Tube) is untouched; a new `buildMultiLegTube` in App.jsx calls it
once per consecutive stop pair and concatenates the results (positions,
colors, indices with running vertex-offsets, year-ring positions) into one
geometry, reusing the existing `s.tubeMesh`/`s.tubeYearRings` objects — no
new scene objects, so ship-view hiding and Travel-Time View's mutual
exclusion both keep working unmodified. The tube-rebuild effect gained a
precedence rule: a new `universeRouteStops` array (set the moment a
universe is selected, or live-updated from Known Space's checklist) draws
instead of the classic 2-star mission-brief pair while it's set — verified
the classic pair still renders correctly with no universe selected
(regression check, screenshot-confirmed).

**The Project Hail Mary route was wrong in the original PR and the user
caught it.** I'd shipped Tau Ceti alone, having verified only Rocky's own
outbound leg (Eridani→Tau Ceti) and concluded there was no single-ship
connection worth drawing. The user asked for Sun→Tau Ceti→Erid as one
connected route; re-checked via WebSearch rather than trusting my first
pass, and found the book's actual ending: Grace turns the Hail Mary around
at the climax to rescue Rocky's dying ship and accompanies him home to
Erid, where he stays (projecthailmary.fandom.com/wiki/Rocky, cross-checked
against multiple ending-explainer sources). So it *is* one real character
arc across three real stars — my first pass was incomplete research, not
a case for refusing the connection; the user's memory of the book was
right. Added Keid (40 Eridani A — IAU name confirmed via WebSearch,
already present in the catalog) to the star mappings, replaced the single
2-stop route with `Sun → Tau Cet → Keid`, citation explicit that it's two
narrative legs (solo outbound, then the return with Rocky) not one
unbroken flight path.

**Known Space became an interactive route builder**: a checkbox + ▲/▼
reorder per colony (plain array-swap on click, no drag-and-drop library —
works identically on touch), live-deriving `universeRouteStops` as
`[Sun, ...checked stops in list order]` on every change. Verified
precisely (a first test pass gave a false failure from an imprecise DOM
selector grabbing the wrong checkbox in headless testing, not an app bug
— re-verified with an exact selector): unchecking Jinx excludes Sirius
from the route without disturbing the other three; moving "We Made It" to
the top changes the flown order to `Sun → Procyon → Rigil Kentaurus → Tau
Cet`, confirmed via both the live tube preview (screenshot) and the actual
`ROUTE ·` header text on departure.

**Bug caught during this verification pass, unrelated to the redesign
itself**: `nameFor()` only checked `cat.nameByIndex`, not
`cat.desigByIndex` — any route through a designation-only star (Tau Ceti
has no IAU proper name) rendered as `STAR #7118` in the route header and
trip bar instead of `TAU CET`. Same class of gap as the `computeBoxSelect`
fix earlier this session, just a different call site; fixed the same way.

**Fixed 2026-08-12 — ship-view touch look-around** (user: "it works great
on desktop — not on mobile"). Root cause: `onTM` (the touch-move handler)
never branched on `s.mode === "ship"` at all, unlike the mouse handler
right above it — a 1-finger drag always drove the atlas `theta`/`phi`
orbit and a 2-finger pinch always drove `radius`/`panBy`, none of which
ship mode's camera reads (it uses `shipYaw`/`shipPitch`/`shipFov`
instead), so touch input in ship view silently updated variables nobody
was looking at. Added the same `s.mode === "ship"` branch already used in
the mouse path: 1-finger drag now drives `shipYaw`/`shipPitch` with the
identical sensitivity formula, 2-finger pinch drives `shipFov` (mirroring
`onWheel`'s ship-mode zoom) instead of `panBy`, which has no ship-view
equivalent (no separate camera target to pan when the camera *is* the
ship). Verified with synthetic `TouchEvent`s dispatched at the canvas in
headless Chrome (real touch hardware isn't available to test with, so
this is the closest verifiable proxy — trusted-vs-untrusted event dispatch
doesn't affect whether `addEventListener` fires): before the fix a 1-
finger drag left the view unchanged; after, the same drag swings Orion off
to the left edge and brings Capella/Auriga to center (yaw), and a second
drag correctly tilts the view (pitch) — both screenshot-confirmed.

### S7 — Full catalog streaming (go/no-go, unchanged, renumbered)

Decision point after S6, not before — the 2.5M-star octree earns a build
only if S5/S6 prove people want to *live* in this thing.

### Backlog

- Multi-hop route planner with crew-age/Earth-calendar ledger — largely
  unscheduled, but S6's Universes canon routes need leg-chaining anyway, so
  expect this to arrive as an S6 side effect rather than its own stage.
- Intercept navigation (aim where a star *will be*, not where it is) — the
  natural companion to a fixed-line trip visibly missing a fast-moving
  destination, which S4.6 made visible but doesn't fix.
- Radiosphere: 110 ly broadcast bubble vs. exoplanet systems
- Earth Transit Zone
- Gaia DR3 deep field

## Working agreements

- Commit early and often; push before session end (non-negotiable)
- PowerShell for anything run manually
- No GitHub API calls in tooling — `raw.githubusercontent.com` reads only
- Ask before adding dependencies beyond three, vite, pandas
- After every PR merge, explicitly verify `devops-frontend.yml` actually ran
  — don't assume the merge's push event triggered it. PR #3's merge
  (2026-08-06) silently produced zero workflow runs, with no config
  difference from the two merges before it that worked fine; root cause
  unclear (likely a transient GitHub Actions hiccup, not a repo/workflow
  regression), fixed by `gh workflow run devops-frontend.yml --ref master`
  and confirmed via matching build hash. Cheap to check, expensive to miss.
