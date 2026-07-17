// B−V color index -> RGB. Ballesteros (2012) B−V -> effective temperature,
// then a compact blackbody -> sRGB fit. Good enough for display; labeled honest
// because it derives from the real measured color index.

const FALLBACK = [0.92, 0.92, 1.0]; // neutral blue-white for missing ci

export function bvToTempK(bv) {
  const b = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

export function tempToRgb(t) {
  const T = Math.max(1000, Math.min(40000, t)) / 100;
  let r, g, b;
  r = T <= 66 ? 255 : 329.698727446 * Math.pow(T - 60, -0.1332047592);
  g = T <= 66 ? 99.4708025861 * Math.log(T) - 161.1195681661
              : 288.1221695283 * Math.pow(T - 60, -0.0755148492);
  b = T >= 66 ? 255 : T <= 19 ? 0 : 138.5177312231 * Math.log(T - 10) - 305.0447927307;
  return [r, g, b].map((v) => Math.max(0, Math.min(255, v)) / 255);
}

export function ciToRgb(ci, sentinel = 50.0) {
  if (!isFinite(ci) || ci > sentinel) return FALLBACK;
  return tempToRgb(bvToTempK(ci));
}

export function rgbToCss([r, g, b]) {
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
