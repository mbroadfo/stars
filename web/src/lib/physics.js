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
