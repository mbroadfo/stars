"""Round-trip gate test for the Tier 1 star buffer.

Reloads tier1.bin, verifies it against manifest.json (count, byte length,
SHA-256), sanity-checks the packed fields, and spot-checks Sirius and Vega
positions against the values the prototype computes from RA/Dec/distance.

Usage (PowerShell):
    python pipeline/test_tier1.py
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

OUT_DIR = Path(__file__).resolve().parent / "data" / "tier1"
EXPECTED_COUNT = 123_018  # profiled: 6D rows at mag <= 9 in AT-HYG v3.2

EQ2GAL = [
    [-0.0548755604, -0.8734370902, -0.4838350155],
    [0.4941094279, -0.4448296300, 0.7469822445],
    [-0.8676661490, -0.1980763734, 0.4559837762],
]

# [RA hours, Dec deg, dist ly] straight from prototype/stellar_atlas.jsx STAR_DATA.
PROTOTYPE_STARS = {
    "Sirius": (6.7525, -16.716, 8.6),
    "Vega": (18.6156, 38.784, 25.0),
}


def prototype_position(ra_h: float, dec_deg: float, dist_ly: float) -> np.ndarray:
    """Replicates starPosition() in the prototype: scene = (gx, gz, -gy) * dist."""
    ra = ra_h / 24 * 2 * math.pi
    dec = math.radians(dec_deg)
    e = [math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)]
    g = [sum(EQ2GAL[r][c] * e[c] for c in range(3)) for r in range(3)]
    return np.array([g[0], g[2], -g[1]]) * dist_ly


def check(label: str, ok: bool, detail: str = "") -> bool:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f" — {detail}" if detail else ""))
    return ok


def main() -> None:
    manifest = json.loads((OUT_DIR / "manifest.json").read_text(encoding="utf-8"))
    names = json.loads((OUT_DIR / "names.json").read_text(encoding="utf-8"))
    buf = (OUT_DIR / "tier1.bin").read_bytes()

    ok = True
    print("[manifest round-trip]")
    ok &= check("byte length", len(buf) == manifest["bytes"], f"{len(buf):,} bytes")
    ok &= check(
        "sha256", hashlib.sha256(buf).hexdigest() == manifest["sha256"], manifest["sha256"][:16]
    )

    stars = np.frombuffer(buf, dtype="<f4").reshape(-1, 8)
    ok &= check(
        "count vs manifest", len(stars) == manifest["count"], f"{len(stars):,} stars"
    )
    delta = len(stars) - EXPECTED_COUNT
    ok &= check(
        f"count vs profile ({EXPECTED_COUNT:,})", abs(delta) <= 100, f"delta {delta:+d}"
    )

    print("[field sanity]")
    ok &= check("all finite", bool(np.isfinite(stars).all()))
    ok &= check("mag <= 9", bool((stars[:, 6] <= 9.0).all()), f"max {stars[:, 6].max():.2f}")
    speed = np.linalg.norm(stars[:, 3:6], axis=1)
    ok &= check(
        "speeds plausible (< 1500 km/s)", bool((speed < 1500).all()), f"max {speed.max():.0f} km/s"
    )
    dist = np.linalg.norm(stars[:, 0:3], axis=1)
    ok &= check(
        "nearest star ~4.2-4.5 ly (Alpha Cen)",
        bool(4.0 < dist.min() < 4.6),
        f"min {dist.min():.2f} ly",
    )

    print("[tier2 far field]")
    t2 = manifest.get("tier2")
    if t2:
        far_buf = (OUT_DIR / t2["file"]).read_bytes()
        ok &= check("tier2 byte length", len(far_buf) == t2["bytes"], f"{len(far_buf):,} bytes")
        ok &= check(
            "tier2 sha256",
            hashlib.sha256(far_buf).hexdigest() == t2["sha256"], t2["sha256"][:16],
        )
        far = np.frombuffer(far_buf, dtype="<f4").reshape(-1, 5)
        ok &= check("tier2 count vs manifest", len(far) == t2["count"], f"{len(far):,} stars")
        ok &= check("tier2 all finite", bool(np.isfinite(far).all()))
        fdist = np.linalg.norm(far[:, 0:3].astype("float64"), axis=1)
        ok &= check(
            "tier2 range 3k-50k ly",
            bool(((fdist > 2900) & (fdist < 51000)).all()),
            f"min {fdist.min():,.0f}, max {fdist.max():,.0f} ly",
        )
    else:
        ok &= check("tier2 present in manifest", False)

    print("[spot-check vs prototype]")
    by_name = {v["name"]: int(k) for k, v in names.items()}
    for name, (ra_h, dec_deg, dist_ly) in PROTOTYPE_STARS.items():
        if name not in by_name:
            ok &= check(f"{name} present in names.json", False)
            continue
        got = stars[by_name[name], 0:3].astype("float64")
        want = prototype_position(ra_h, dec_deg, dist_ly)
        err = float(np.linalg.norm(got - want))
        # Tolerance: prototype distances are rounded (e.g. Vega "25.0 ly"),
        # catalog uses precise parallax; allow 2% of distance + 0.05 ly.
        tol = 0.02 * dist_ly + 0.05
        ok &= check(
            f"{name} position", err <= tol,
            f"catalog ({got[0]:.2f}, {got[1]:.2f}, {got[2]:.2f}) vs prototype "
            f"({want[0]:.2f}, {want[1]:.2f}, {want[2]:.2f}), err {err:.3f} ly (tol {tol:.3f})",
        )

    print("GATE " + ("PASSED" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
