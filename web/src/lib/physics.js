export const C_KMS = 299792.458;
export const G_LY_YR2 = 1.03228; // 1 g in ly/yr^2 (c = 1 ly/yr)
export const KM_PER_LY = 9.4607e12;

// Relativistic 1g-class brachistochrone: accelerate to midpoint, flip, decelerate.
export function journey(distLy, accelG) {
  const A = accelG * G_LY_YR2;
  const X = 1 + (A * distLy) / 2; // peak gamma
  const shipYears = (2 / A) * Math.acosh(X);
  const earthYears = (2 / A) * Math.sqrt(X * X - 1);
  const betaMax = Math.sqrt(X * X - 1) / X;
  return { shipYears, earthYears, betaMax, gammaMax: X };
}

// Waypoint state at fraction f (by distance) of a brachistochrone of total
// distance D ly at accelG. c = 1 ly/yr units. Accelerate to midpoint, flip,
// decelerate: for the accel half at distance x, X = 1 + a·x gives gamma
// directly; tau = acosh(X)/a ship years, t = sqrt(X^2-1)/a Earth years.
// The decel half mirrors: total minus the remaining-distance leg.
export function brachAt(distLy, accelG, f) {
  const a = accelG * G_LY_YR2;
  const x = Math.max(0, Math.min(1, f)) * distLy;
  const Xm = 1 + (a * distLy) / 2; // midpoint gamma
  let gamma, shipYears, earthYears;
  if (x <= distLy / 2) {
    gamma = 1 + a * x;
    shipYears = Math.acosh(gamma) / a;
    earthYears = Math.sqrt(gamma * gamma - 1) / a;
  } else {
    const rem = 1 + a * (distLy - x); // gamma at the mirrored point
    gamma = rem;
    shipYears = (2 * Math.acosh(Xm) - Math.acosh(rem)) / a;
    earthYears = (2 * Math.sqrt(Xm * Xm - 1) - Math.sqrt(rem * rem - 1)) / a;
  }
  const beta = Math.sqrt(gamma * gamma - 1) / gamma;
  return { shipYears, earthYears, beta, gamma };
}

// Closure rate from full 3D velocities (km/s): d/dt |posB - posA|.
// Negative = closing. This is the upgrade over the prototype's
// radial-velocity-only estimate — Tier 1 carries true velocity vectors.
export function closureRate(a, b) {
  const sx = b.x - a.x, sy = b.y - a.y, sz = b.z - a.z;
  const sep = Math.hypot(sx, sy, sz);
  if (sep === 0) return 0;
  return ((b.vx - a.vx) * sx + (b.vy - a.vy) * sy + (b.vz - a.vz) * sz) / sep;
}

export function separationLy(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

const KMS_TO_LYYR = 1 / C_KMS; // 1 ly/yr = c, so km/s -> ly/yr divides by c in km/s

// Where a star's straight-line motion (constant velocity, S1's model) puts it
// `years` from now. Positions in ly, velocities in km/s — matches getStar().
// years=0 is a no-op (returns the same object) so callers never need to branch.
export function advanceStar(star, years) {
  if (!years) return star;
  const x = star.x + star.vx * KMS_TO_LYYR * years;
  const y = star.y + star.vy * KMS_TO_LYYR * years;
  const z = star.z + star.vz * KMS_TO_LYYR * years;
  const ly = Math.hypot(x, y, z);
  // Radial velocity is v . unit(pos) at the CURRENT position — as a star
  // passes its closest approach this flips sign (approaching -> receding),
  // which is physically real, not an artifact.
  const rv = ly > 0 ? (star.vx * x + star.vy * y + star.vz * z) / ly : 0;
  return { ...star, x, y, z, ly, rv };
}

// Minimum of |p0 + v*t|^2 over all t (constant-velocity straight-line
// approximation — the same model advanceStar uses). Returns null for a
// star with no meaningful velocity (would return years=NaN otherwise).
export function closestApproach(star) {
  const vx = star.vx * KMS_TO_LYYR, vy = star.vy * KMS_TO_LYYR, vz = star.vz * KMS_TO_LYYR;
  const vv = vx * vx + vy * vy + vz * vz;
  if (vv < 1e-30) return null;
  const pv = star.x * vx + star.y * vy + star.z * vz;
  const years = -pv / vv;
  const distanceLy = Math.sqrt(Math.max(0, star.x * star.x + star.y * star.y + star.z * star.z - (pv * pv) / vv));
  return { years, distanceLy };
}

export function fmt(n, digits = 1) {
  if (!isFinite(n)) return "—";
  if (n >= 10000) return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtYears(y) {
  if (y < 1) return `${fmt(y * 12, 1)} months`;
  if (y < 10000) return `${fmt(y, y < 100 ? 1 : 0)} years`;
  return `${fmt(y, 0)} years`;
}
