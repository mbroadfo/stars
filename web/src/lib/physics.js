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
