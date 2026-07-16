"""Build the Tier 1 star buffer from the AT-HYG v3.2 catalog.

Downloads the two catalog parts (NOTE: part 2 ships without a header row),
culls to apparent mag <= 9 with full 6D data (x0,y0,z0 + vx,vy,vz), converts
positions from parsecs/equatorial to light-years in the prototype's galactic
scene frame (X -> galactic center, Y -> north galactic pole, Z = -galactic_y),
rotates velocity vectors into the same frame, and packs a little-endian
Float32 binary at 32 bytes/star:

    x, y, z (ly, scene frame) . vx, vy, vz (km/s, scene frame) . mag . colorIndex

Sidecars: names.json (proper name + spectral class, keyed by row index in the
packed buffer) and manifest.json (row count, byte length, SHA-256, build notes).

Output is deterministic: rows are sorted by catalog id before packing.

Usage (PowerShell):
    python pipeline/build_tier1.py            # download if needed, build
    python pipeline/build_tier1.py --force    # rebuild even if outputs exist
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

BASE_URL = "https://raw.githubusercontent.com/astronexus/ATHYG-Database/main/data"
PARTS = ["athyg_v32-1.csv.gz", "athyg_v32-2.csv.gz"]

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR / "data"
OUT_DIR = DATA_DIR / "tier1"

MAG_LIMIT = 9.0
PC_TO_LY = 3.2615637769757

# Equatorial J2000 -> Galactic rotation (rows), same matrix as the prototype.
EQ2GAL = np.array(
    [
        [-0.0548755604, -0.8734370902, -0.4838350155],
        [0.4941094279, -0.4448296300, 0.7469822445],
        [-0.8676661490, -0.1980763734, 0.4559837762],
    ]
)

# Missing color index sentinel (documented in manifest.json).
CI_SENTINEL = 99.0

USECOLS = ["id", "proper", "spect", "mag", "ci", "x0", "y0", "z0", "vx", "vy", "vz"]
DTYPES = {
    "id": "int64",
    "proper": "string",
    "spect": "string",
    "mag": "float64",
    "ci": "float64",
    "x0": "float64",
    "y0": "float64",
    "z0": "float64",
    "vx": "float64",
    "vy": "float64",
    "vz": "float64",
}


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  cached: {dest.name} ({dest.stat().st_size:,} bytes)")
        return
    print(f"  downloading {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as resp, open(tmp, "wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)
    tmp.replace(dest)
    print(f"  saved: {dest.name} ({dest.stat().st_size:,} bytes)")


def read_header_columns(path: Path) -> list[str]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return f.readline().strip().split(",")


def load_catalog() -> pd.DataFrame:
    part1, part2 = (DATA_DIR / p for p in PARTS)
    columns = read_header_columns(part1)
    print(f"  part 1 header: {len(columns)} columns")
    missing = [c for c in USECOLS if c not in columns]
    if missing:
        sys.exit(f"FATAL: expected columns missing from catalog header: {missing}")

    df1 = pd.read_csv(part1, usecols=USECOLS, dtype=DTYPES)
    # Part 2 has NO header row -- reuse part 1's columns.
    df2 = pd.read_csv(part2, header=None, names=columns, usecols=USECOLS, dtype=DTYPES)
    df = pd.concat([df1, df2], ignore_index=True)
    print(f"  merged rows: {len(df):,}")
    return df


def build(df: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    six_d = df[["x0", "y0", "z0", "vx", "vy", "vz"]].notna().all(axis=1)
    keep = six_d & df["mag"].notna() & (df["mag"] <= MAG_LIMIT)
    culled = df[keep].sort_values("id", kind="mergesort").reset_index(drop=True)
    print(f"  full 6D: {int(six_d.sum()):,}; 6D and mag <= {MAG_LIMIT:g}: {len(culled):,}")

    # Positions: parsecs, equatorial cartesian -> galactic -> scene frame, ly.
    pos_eq = culled[["x0", "y0", "z0"]].to_numpy() * PC_TO_LY
    pos_gal = pos_eq @ EQ2GAL.T
    vel_eq = culled[["vx", "vy", "vz"]].to_numpy()
    vel_gal = vel_eq @ EQ2GAL.T

    def to_scene(g: np.ndarray) -> np.ndarray:
        # Scene: X = gx (galactic center), Y = gz (north galactic pole), Z = -gy.
        return np.column_stack([g[:, 0], g[:, 2], -g[:, 1]])

    ci = culled["ci"].to_numpy(dtype="float64", na_value=CI_SENTINEL)
    packed = np.column_stack(
        [to_scene(pos_gal), to_scene(vel_gal), culled["mag"].to_numpy(), ci]
    ).astype("<f4")
    return packed, culled


def write_outputs(packed: np.ndarray, culled: pd.DataFrame) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    bin_path = OUT_DIR / "tier1.bin"
    buf = packed.tobytes()
    bin_path.write_bytes(buf)
    sha = hashlib.sha256(buf).hexdigest()

    named = culled[culled["proper"].notna()]
    names = {
        str(idx): {
            "name": row.proper,
            "spect": row.spect if pd.notna(row.spect) else None,
        }
        for idx, row in named.iterrows()
    }
    (OUT_DIR / "names.json").write_text(
        json.dumps(names, indent=1, sort_keys=False), encoding="utf-8"
    )

    manifest = {
        "source": [f"{BASE_URL}/{p}" for p in PARTS],
        "filters": f"apparent mag <= {MAG_LIMIT:g} AND non-null x0,y0,z0,vx,vy,vz",
        "count": int(len(packed)),
        "bytes": len(buf),
        "sha256": sha,
        "stride_bytes": 32,
        "layout": "little-endian float32 x8: x,y,z (ly, scene) | vx,vy,vz (km/s, scene) | mag | colorIndex",
        "frame": "Sun at origin; scene X -> galactic center, Y -> north galactic pole, Z = -galactic_y; 1 unit = 1 ly",
        "velocity_frame": "same scene/galactic frame as positions (rotated with EQ2GAL)",
        "ci_missing_sentinel": CI_SENTINEL,
        "ci_missing_count": int((culled["ci"].isna()).sum()),
        "named_count": len(names),
        "sort": "ascending AT-HYG catalog id (deterministic)",
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    print(f"  wrote {bin_path} ({len(buf):,} bytes, {len(packed):,} stars)")
    print(f"  wrote names.json ({len(names):,} named stars)")
    print(f"  sha256: {sha}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="rebuild even if outputs exist")
    args = ap.parse_args()

    if not args.force and (OUT_DIR / "manifest.json").exists():
        print(f"outputs already exist in {OUT_DIR} (use --force to rebuild)")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("[1/3] download")
    for part in PARTS:
        download(f"{BASE_URL}/{part}", DATA_DIR / part)
    print("[2/3] load + cull + transform")
    packed, culled = build(load_catalog())
    print("[3/3] write outputs")
    write_outputs(packed, culled)


if __name__ == "__main__":
    main()
