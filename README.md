# STARS

Fly through the real galaxy. Actual stars at their true 3D positions — Gaia-era
astrometry, positions **and** velocity vectors — navigable with SketchUp-style
orbit/pan/zoom controls.

**Thesis: everyone builds maps; nobody builds instruments.** The signature features
are the ones no commercial planetarium ships:

- **Measurement tethers** — grab two stars, get true 3D separation
- **Closure rates** — are they closing or separating, and how fast (real velocity vectors)
- **Relativistic mission briefs** — constant-1g brachistochrone: ship time, Earth time, peak γ
- **Intercept navigation** — aim where a star *will* be, not where it is
- **Deep-time scrubbing** — drag ±100k years, watch the Big Dipper dissolve

Design language: *observatory brass* — near-black indigo space, amber instrument
accents (`#e8b45a`), Georgia serif display, monospace data readouts. Chart cartouche,
not game HUD. Honesty policy: real data rendered as real; anything procedural is labeled.

## Layout

| Path | Contents |
| --- | --- |
| `prototype/` | v0 single-file React + Three.js prototype (105 embedded stars) — the design reference |
| `pipeline/` | Python data pipeline: AT-HYG catalog → packed Float32 star buffer |
| `web/` | (S2) Vite + React + Three.js viewer |
| `docs/` | [Plan & roadmap](docs/PLAN.md) |

## Coordinate convention

Sun at origin, 1 unit = 1 light-year, galactic frame: scene X → galactic center,
scene Y → north galactic pole, scene Z = −(galactic Y) (right-handed).
