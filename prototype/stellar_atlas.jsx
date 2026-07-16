import React, { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";

/* ============================================================
   STELLAR NEIGHBORHOOD — a navigable atlas
   Real stars, real distances. 1 scene unit = 1 light-year.
   Sun at origin. Galactic plane = XZ. Galactic center at +X.
   ============================================================ */

// [name, RA hours, Dec deg, dist ly, app mag, spectral, radial velocity km/s (neg = approaching)]
const STAR_DATA = [
  ["Sirius", 6.7525, -16.716, 8.6, -1.46, "A1V", -5.5],
  ["Canopus", 6.3992, -52.696, 310, -0.74, "A9II", 20.3],
  ["Alpha Centauri", 14.6600, -60.834, 4.37, -0.27, "G2V", -22.3],
  ["Arcturus", 14.2610, 19.182, 36.7, -0.05, "K1.5III", -5.2],
  ["Vega", 18.6156, 38.784, 25.0, 0.03, "A0V", -13.9],
  ["Capella", 5.2782, 45.998, 42.9, 0.08, "G8III", 29.9],
  ["Rigel", 5.2423, -8.202, 860, 0.13, "B8Ia", 17.8],
  ["Procyon", 7.6550, 5.225, 11.5, 0.34, "F5IV", -3.2],
  ["Achernar", 1.6286, -57.237, 139, 0.46, "B6V", 16.0],
  ["Betelgeuse", 5.9195, 7.407, 548, 0.50, "M1Ia", 21.9],
  ["Hadar", 14.0637, -60.373, 390, 0.61, "B1III", 5.9],
  ["Altair", 19.8464, 8.868, 16.7, 0.76, "A7V", -26.1],
  ["Acrux", 12.4433, -63.099, 320, 0.76, "B0.5IV", -11.2],
  ["Aldebaran", 4.5987, 16.509, 65.3, 0.86, "K5III", 54.3],
  ["Antares", 16.4901, -26.432, 550, 0.96, "M1.5Ib", -3.4],
  ["Spica", 13.4199, -11.161, 250, 0.97, "B1III", 1.0],
  ["Pollux", 7.7553, 28.026, 33.8, 1.14, "K0III", 3.2],
  ["Fomalhaut", 22.9608, -29.622, 25.1, 1.16, "A3V", 6.5],
  ["Deneb", 20.6905, 45.280, 2615, 1.25, "A2Ia", -4.5],
  ["Mimosa", 12.7953, -59.689, 280, 1.25, "B0.5III", 15.6],
  ["Regulus", 10.1395, 11.967, 79.3, 1.39, "B8IV", 5.9],
  ["Adhara", 6.9771, -28.972, 430, 1.50, "B2II", 27.3],
  ["Castor", 7.5766, 31.888, 51.0, 1.62, "A1V", 5.2],
  ["Shaula", 17.5601, -37.104, 570, 1.63, "B2IV", -3.0],
  ["Gacrux", 12.5194, -57.113, 88.6, 1.64, "M3.5III", 21.4],
  ["Bellatrix", 5.4189, 6.350, 250, 1.64, "B2III", 18.2],
  ["Elnath", 5.4382, 28.608, 134, 1.65, "B7III", 9.2],
  ["Miaplacidus", 9.2200, -69.717, 113, 1.69, "A1III", -5.0],
  ["Alnilam", 5.6036, -1.202, 2000, 1.69, "B0Ia", 25.9],
  ["Alnair", 22.1372, -46.961, 101, 1.74, "B6V", 11.8],
  ["Alnitak", 5.6793, -1.943, 1260, 1.77, "O9.5Ib", 18.5],
  ["Alioth", 12.9005, 55.960, 82.6, 1.77, "A1III", -9.3],
  ["Dubhe", 11.0622, 61.751, 123, 1.79, "K0III", -9.0],
  ["Mirfak", 3.4054, 49.861, 510, 1.80, "F5Ib", -2.0],
  ["Wezen", 7.1399, -26.393, 1600, 1.82, "F8Ia", 34.3],
  ["Sargas", 17.6219, -42.998, 300, 1.84, "F0II", 1.4],
  ["Kaus Australis", 18.4029, -34.385, 143, 1.85, "B9.5III", -15.0],
  ["Avior", 8.3752, -59.510, 610, 1.86, "K3III", 11.6],
  ["Alkaid", 13.7923, 49.313, 104, 1.86, "B3V", -13.4],
  ["Menkalinan", 5.9921, 44.948, 81.0, 1.90, "A1IV", -18.2],
  ["Atria", 16.8110, -69.028, 391, 1.91, "K2Ib", -3.0],
  ["Alhena", 6.6285, 16.399, 109, 1.92, "A1IV", -12.5],
  ["Peacock", 20.4275, -56.735, 179, 1.94, "B2IV", 2.0],
  ["Alsephina", 8.7451, -54.709, 80.6, 1.96, "A1V", 2.2],
  ["Mirzam", 6.3783, -17.956, 500, 1.98, "B1II", 33.7],
  ["Alphard", 9.4598, -8.659, 177, 1.98, "K3II", -4.3],
  ["Polaris", 2.5303, 89.264, 433, 1.98, "F7Ib", -17.0],
  ["Hamal", 2.1196, 23.463, 65.8, 2.00, "K1III", -14.2],
  ["Diphda", 0.7265, -17.987, 96.3, 2.02, "K0III", 12.9],
  ["Mizar", 13.3988, 54.925, 82.9, 2.04, "A2V", -5.6],
  ["Nunki", 18.9211, -26.297, 228, 2.06, "B2.5V", -11.2],
  ["Menkent", 14.1114, -36.370, 58.8, 2.06, "K0III", 1.3],
  ["Mirach", 1.1622, 35.620, 197, 2.05, "M0III", 3.0],
  ["Alpheratz", 0.1398, 29.091, 97.0, 2.06, "B8IV", -10.6],
  ["Rasalhague", 17.5822, 12.560, 48.6, 2.07, "A5III", 11.7],
  ["Kochab", 14.8451, 74.156, 130.9, 2.08, "K4III", 16.9],
  ["Saiph", 5.7959, -9.670, 650, 2.09, "B0.5Ia", 20.5],
  ["Algieba", 10.3329, 19.842, 130, 2.08, "K1III", -36.7],
  ["Denebola", 11.8177, 14.572, 35.9, 2.13, "A3V", -0.2],
  ["Algol", 3.1361, 40.956, 90.0, 2.12, "B8V", 3.7],
  ["Tiaki", 22.7111, -46.885, 177, 2.15, "M5III", 1.6],
  ["Muhlifain", 12.6919, -48.960, 130, 2.17, "A1IV", -5.5],
  ["Aspidiske", 9.2848, -59.275, 690, 2.21, "A9Ib", 13.3],
  ["Suhail", 9.1333, -43.433, 545, 2.21, "K4Ib", 18.4],
  ["Alphecca", 15.5781, 26.715, 75.0, 2.22, "A0V", 1.7],
  ["Mintaka", 5.5334, -0.299, 1200, 2.25, "O9.5II", 16.0],
  ["Sadr", 20.3705, 40.257, 1800, 2.23, "F8Ib", -8.0],
  ["Eltanin", 17.9434, 51.489, 154, 2.24, "K5III", -28.0],
  ["Schedar", 0.6751, 56.537, 228, 2.24, "K0II", -4.3],
  ["Naos", 8.0598, -40.003, 1080, 2.21, "O4I", -23.9],
  ["Almach", 2.0650, 42.330, 390, 2.26, "K3II", -12.0],
  ["Caph", 0.1529, 59.150, 54.7, 2.28, "F2III", 11.3],
  ["Izar", 14.7498, 27.074, 202, 2.37, "K0II", -16.3],
  ["Dschubba", 16.0056, -22.622, 400, 2.29, "B0.3IV", -7.0],
  ["Larawag", 16.8361, -34.293, 63.7, 2.29, "K1III", -2.5],
  ["Merak", 11.0307, 56.383, 79.7, 2.37, "A1V", -12.0],
  ["Ankaa", 0.4381, -42.306, 82.0, 2.40, "K0III", 74.5],
  ["Girtab", 17.7081, -39.030, 480, 2.39, "B1.5III", -14.0],
  ["Enif", 21.7364, 9.875, 690, 2.38, "K2Ib", 5.0],
  ["Scheat", 23.0629, 28.083, 196, 2.42, "M2II", 7.4],
  ["Sabik", 17.1725, -15.725, 88.0, 2.43, "A2V", -1.0],
  ["Phecda", 11.8972, 53.695, 83.2, 2.44, "A0V", -12.6],
  ["Aludra", 7.4016, -29.303, 2000, 2.45, "B5Ia", 41.1],
  ["Markab", 23.0793, 15.205, 133, 2.49, "A0IV", -4.0],
  ["Albireo", 19.5120, 27.960, 430, 3.18, "K3II", -24.0],
  ["Mira", 2.3224, -2.978, 300, 3.04, "M7III", 63.8],
  ["Mu Cephei", 21.7254, 58.780, 2840, 4.08, "M2Ia", 20.6],
  // ---- Famous nearby (dim, but our closest neighbors) ----
  ["Proxima Centauri", 14.4953, -62.679, 4.246, 11.13, "M5.5V", -22.2],
  ["Barnard's Star", 17.9634, 4.693, 5.96, 9.51, "M4V", -110.5],
  ["Wolf 359", 10.9414, 7.014, 7.86, 13.54, "M6V", 19.0],
  ["Lalande 21185", 11.0552, 35.970, 8.31, 7.52, "M2V", -85.0],
  ["UV Ceti", 1.6519, -17.950, 8.73, 12.54, "M5.5V", 29.0],
  ["Ross 154", 18.8283, -23.836, 9.70, 10.44, "M3.5V", -10.7],
  ["Epsilon Eridani", 3.5486, -9.458, 10.48, 3.73, "K2V", 15.5],
  ["Lacaille 9352", 23.0990, -35.853, 10.74, 7.34, "M1V", 9.7],
  ["Ross 128", 11.7928, 0.805, 11.0, 11.13, "M4V", -31.0],
  ["61 Cygni", 21.1147, 38.749, 11.4, 5.21, "K5V", -65.7],
  ["Epsilon Indi", 22.0553, -56.786, 11.87, 4.69, "K5V", -40.4],
  ["Tau Ceti", 1.7343, -15.937, 11.9, 3.50, "G8V", -16.7],
  ["Gliese 581", 15.3218, -7.722, 20.5, 10.57, "M3V", -9.5],
  ["TRAPPIST-1", 23.1080, -5.041, 40.7, 18.8, "M8V", -54.0],
];

// Equatorial J2000 -> Galactic rotation matrix (rows)
const EQ2GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];

const SPEC_COLOR = {
  O: "#9db4ff", B: "#aabfff", A: "#cdd8ff", F: "#f6f4ff",
  G: "#fff3e0", K: "#ffd9a3", M: "#ffb56b",
};

const C_KMS = 299792.458;
const G_LY_YR2 = 1.03228; // 1 g in ly/yr^2 (c = 1 ly/yr)
const AMBER = "#e8b45a";
const ICE = "#8fd3ff";

function starPosition(raH, decDeg, distLy) {
  const ra = (raH / 24) * 2 * Math.PI;
  const dec = (decDeg * Math.PI) / 180;
  const ex = Math.cos(dec) * Math.cos(ra);
  const ey = Math.cos(dec) * Math.sin(ra);
  const ez = Math.sin(dec);
  const gx = EQ2GAL[0][0] * ex + EQ2GAL[0][1] * ey + EQ2GAL[0][2] * ez;
  const gy = EQ2GAL[1][0] * ex + EQ2GAL[1][1] * ey + EQ2GAL[1][2] * ez;
  const gz = EQ2GAL[2][0] * ex + EQ2GAL[2][1] * ey + EQ2GAL[2][2] * ez;
  // Scene: X = toward galactic center, Y = north galactic pole, Z = -gy (right-handed)
  return new THREE.Vector3(gx * distLy, gz * distLy, -gy * distLy);
}

// Relativistic 1g-class brachistochrone: accelerate to midpoint, flip, decelerate.
function journey(distLy, accelG) {
  const A = accelG * G_LY_YR2;
  const X = 1 + (A * distLy) / 2; // peak gamma
  const shipYears = (2 / A) * Math.acosh(X);
  const earthYears = (2 / A) * Math.sqrt(X * X - 1);
  const betaMax = Math.sqrt(X * X - 1) / X;
  return { shipYears, earthYears, betaMax, gammaMax: X };
}

function fmt(n, digits = 1) {
  if (!isFinite(n)) return "—";
  if (n >= 10000) return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
function fmtYears(y) {
  if (y < 1) return `${fmt(y * 12, 1)} months`;
  if (y < 10000) return `${fmt(y, y < 100 ? 1 : 0)} years`;
  return `${fmt(y, 0)} years`;
}

// Precompute stars
const STARS = STAR_DATA.map((d, i) => {
  const [name, ra, dec, ly, mag, spec, rv] = d;
  return {
    i, name, ly, mag, spec, rv,
    pos: starPosition(ra, dec, ly),
    color: SPEC_COLOR[spec[0]] || "#ffffff",
    nearby: mag > 3.4, // the dim famous neighbors
  };
});

export default function StellarAtlas() {
  const mountRef = useRef(null);
  const labelsRef = useRef(null);
  const stateRef = useRef({});
  const [selected, setSelected] = useState([]); // star indices, max 2
  const [hovered, setHovered] = useState(null);
  const [accel, setAccel] = useState(1);
  const [camDist, setCamDist] = useState(60);
  const [showHelp, setShowHelp] = useState(true);

  const flyTo = useCallback((targetVec, radius) => {
    const s = stateRef.current;
    if (!s.camera) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    s.flyAnim = {
      t: 0,
      dur: reduced ? 0.001 : 1.1,
      fromTarget: s.target.clone(),
      toTarget: targetVec.clone(),
      fromRadius: s.radius,
      toRadius: radius,
    };
  }, []);

  // ---------------- Three.js scene ----------------
  useEffect(() => {
    const mount = mountRef.current;
    const s = stateRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(new THREE.Color("#04060d"), 1);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400000);

    // Orbit state (SketchUp-style)
    s.target = new THREE.Vector3(0, 0, 0);
    s.radius = 60;
    s.theta = Math.PI * 0.35; // azimuth
    s.phi = Math.PI * 0.38;   // polar
    s.camera = camera;
    s.renderer = renderer;

    // --- Star field (named stars) ---
    const n = STARS.length;
    const posArr = new Float32Array(n * 3);
    const colArr = new Float32Array(n * 3);
    const sizeArr = new Float32Array(n);
    STARS.forEach((st, i) => {
      posArr.set([st.pos.x, st.pos.y, st.pos.z], i * 3);
      const c = new THREE.Color(st.color);
      colArr.set([c.r, c.g, c.b], i * 3);
      sizeArr[i] = st.nearby ? 4.0 : Math.max(4.5, 15.5 - 2.6 * st.mag);
    });
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    starGeo.setAttribute("psize", new THREE.BufferAttribute(sizeArr, 1));
    const starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float psize; attribute vec3 color; varying vec3 vColor;
        void main(){ vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=psize; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `
        varying vec3 vColor;
        void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv);
          float core=smoothstep(0.16,0.02,d); float halo=smoothstep(0.5,0.08,d)*0.55;
          float a=clamp(core+halo,0.0,1.0); if(a<0.02) discard;
          gl_FragColor=vec4(mix(vColor,vec3(1.0),core*0.7),a); }`,
    });
    scene.add(new THREE.Points(starGeo, starMat));

    // --- Procedural Milky Way (context, ~100k ly across) ---
    const GAL_R = 52000, GAL_CENTER = new THREE.Vector3(26660, 0, 0);
    const gN = 24000;
    const gPos = new Float32Array(gN * 3), gCol = new Float32Array(gN * 3);
    const cIn = new THREE.Color("#ffd9a0"), cOut = new THREE.Color("#8fa8ff");
    for (let i = 0; i < gN; i++) {
      const arm = i % 4;
      const rr = Math.pow(Math.random(), 1.6) * GAL_R;
      const spin = rr * 0.00028;
      const ang = spin + (arm * Math.PI) / 2 + (Math.random() - 0.5) * (0.9 - 0.5 * (rr / GAL_R));
      const bulge = Math.exp(-rr / 6000);
      const thick = 260 + bulge * 2200;
      const x = Math.cos(ang) * rr + (Math.random() - 0.5) * 1300;
      const z = Math.sin(ang) * rr + (Math.random() - 0.5) * 1300;
      const y = (Math.random() + Math.random() + Math.random() - 1.5) * thick * 0.66;
      gPos.set([GAL_CENTER.x + x, y, GAL_CENTER.z + z], i * 3);
      const c = cIn.clone().lerp(cOut, Math.min(1, rr / GAL_R + Math.random() * 0.15));
      const dim = 0.35 + bulge * 0.65;
      gCol.set([c.r * dim, c.g * dim, c.b * dim], i * 3);
    }
    const galGeo = new THREE.BufferGeometry();
    galGeo.setAttribute("position", new THREE.BufferAttribute(gPos, 3));
    galGeo.setAttribute("color", new THREE.BufferAttribute(gCol, 3));
    const galMat = new THREE.PointsMaterial({
      size: 2, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(galGeo, galMat));

    // --- Sun marker ---
    const sunGeo = new THREE.BufferGeometry();
    sunGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    sunGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array([1, 0.95, 0.8]), 3));
    sunGeo.setAttribute("psize", new THREE.BufferAttribute(new Float32Array([13]), 1));
    scene.add(new THREE.Points(sunGeo, starMat));

    // --- Distance rings (log scale) in galactic plane ---
    const ringGroup = new THREE.Group();
    const ringRadii = [10, 100, 1000, 10000];
    ringRadii.forEach((r) => {
      const pts = [];
      for (let a = 0; a <= 128; a++) {
        const t = (a / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(t) * r, 0, Math.sin(t) * r));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = new THREE.LineBasicMaterial({ color: 0x33415e, transparent: true, opacity: 0.5 });
      ringGroup.add(new THREE.Line(g, m));
    });
    scene.add(ringGroup);

    // --- Tether line (measurement) ---
    const tetherGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const tether = new THREE.Line(tetherGeo, new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.95 }));
    tether.visible = false;
    scene.add(tether);
    s.tether = tether;

    // Selection halo rings
    const mkHalo = (color) => {
      const cnv = document.createElement("canvas"); cnv.width = cnv.height = 64;
      const ctx = cnv.getContext("2d");
      ctx.strokeStyle = color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.stroke();
      const tex = new THREE.CanvasTexture(cnv);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sp.visible = false; scene.add(sp); return sp;
    };
    s.haloA = mkHalo(AMBER); s.haloB = mkHalo(AMBER);

    // --- Labels (HTML overlay) ---
    const labelHost = labelsRef.current;
    const labelStars = STARS.filter((st) => st.mag <= 1.7 || st.nearby || ["Polaris", "Antares", "Spica", "Deneb", "Aldebaran"].includes(st.name));
    const labelEls = labelStars.map((st) => {
      const el = document.createElement("div");
      el.textContent = st.name;
      el.style.cssText = `position:absolute;transform:translate(-50%,-140%);pointer-events:none;
        font:11px ui-monospace,Menlo,monospace;letter-spacing:0.06em;white-space:nowrap;
        color:${st.nearby ? "#7f93b8" : "#c9d4ea"};text-shadow:0 1px 3px #000;`;
      labelHost.appendChild(el);
      return { el, star: st };
    });
    const mkTag = (text, color) => {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = `position:absolute;transform:translate(-50%,-140%);pointer-events:none;
        font:11px ui-monospace,monospace;letter-spacing:0.1em;color:${color};text-shadow:0 1px 3px #000;`;
      labelHost.appendChild(el); return el;
    };
    const sunLabel = mkTag("SUN", "#ffe9b8");
    const sgrLabel = mkTag("SGR A* · GALACTIC CENTER · 26,000 ly", "#c9a3ff");
    const ringLabels = ringRadii.map((r) => mkTag(r.toLocaleString() + " ly", "#5a6a8f"));

    // ---------------- Interaction ----------------
    const el = renderer.domElement;
    let drag = null, moved = 0;
    const onDown = (e) => {
      drag = { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey };
      moved = 0;
    };
    const onMove = (e) => {
      // Hover pick (throttle-free — cheap at ~100 stars)
      if (!drag) {
        const hit = pick(e.clientX, e.clientY);
        setHovered(hit); el.style.cursor = hit != null ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (drag.btn === 2 || drag.shift) {
        panBy(dx, dy);
      } else {
        s.theta -= dx * 0.0055;
        s.phi = Math.max(0.05, Math.min(Math.PI - 0.05, s.phi - dy * 0.0055));
      }
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const onUp = (e) => {
      if (drag && moved < 6 && drag.btn === 0) {
        const hit = pick(e.clientX, e.clientY);
        if (hit != null) {
          setSelected((prev) => {
            if (prev.includes(hit)) return prev.filter((p) => p !== hit);
            if (prev.length >= 2) return [prev[1], hit];
            return [...prev, hit];
          });
        }
      }
      drag = null;
    };
    const onWheel = (e) => {
      e.preventDefault();
      s.radius *= Math.pow(1.0016, e.deltaY);
      s.radius = Math.max(0.4, Math.min(220000, s.radius));
    };
    const onDbl = (e) => {
      const hit = pick(e.clientX, e.clientY);
      if (hit != null) flyToStar(hit);
    };
    const flyToStar = (idx) => {
      const st = STARS[idx];
      flyTo(st.pos, Math.max(3, st.ly * 0.35));
    };
    s.flyToStar = flyToStar;

    function panBy(dx, dy) {
      const scale = s.radius * 0.0016;
      const q = camera.quaternion;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      s.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    }
    function pick(cx, cy) {
      const rect = el.getBoundingClientRect();
      const px = cx - rect.left, py = cy - rect.top;
      let best = null, bestD = 16;
      const v = new THREE.Vector3();
      for (const st of STARS) {
        v.copy(st.pos).project(camera);
        if (v.z > 1) continue;
        const sx = (v.x * 0.5 + 0.5) * rect.width, sy = (-v.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestD) { bestD = d; best = st.i; }
      }
      return best;
    }

    // Touch: 1 finger orbit, 2 finger pinch-zoom + pan
    let touch = null;
    const onTS = (e) => {
      if (e.touches.length === 1) touch = { mode: "orbit", x: e.touches[0].clientX, y: e.touches[0].clientY };
      else if (e.touches.length === 2) {
        const [a, b] = e.touches;
        touch = { mode: "pinch", d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
      }
    };
    const onTM = (e) => {
      e.preventDefault();
      if (!touch) return;
      if (touch.mode === "orbit" && e.touches.length === 1) {
        const t = e.touches[0];
        s.theta -= (t.clientX - touch.x) * 0.0055;
        s.phi = Math.max(0.05, Math.min(Math.PI - 0.05, s.phi - (t.clientY - touch.y) * 0.0055));
        touch.x = t.clientX; touch.y = t.clientY;
      } else if (touch.mode === "pinch" && e.touches.length === 2) {
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        s.radius = Math.max(0.4, Math.min(220000, s.radius * (touch.d / d)));
        const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
        panBy(cx - touch.cx, cy - touch.cy);
        touch.d = d; touch.cx = cx; touch.cy = cy;
      }
    };
    const onTE = () => { touch = null; };

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDbl);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("touchstart", onTS, { passive: true });
    el.addEventListener("touchmove", onTM, { passive: false });
    el.addEventListener("touchend", onTE);

    // ---------------- Render loop ----------------
    const clock = new THREE.Clock();
    let raf;
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const projTag = (elTag, wp) => {
      const rect = el.getBoundingClientRect();
      const v = wp.clone().project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { elTag.style.display = "none"; return; }
      elTag.style.display = "block";
      elTag.style.left = `${(v.x * 0.5 + 0.5) * rect.width}px`;
      elTag.style.top = `${(-v.y * 0.5 + 0.5) * rect.height}px`;
    };
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      if (s.flyAnim) {
        const f = s.flyAnim; f.t += dt / f.dur;
        const k = easeInOut(Math.min(1, f.t));
        s.target.lerpVectors(f.fromTarget, f.toTarget, k);
        s.radius = f.fromRadius * Math.pow(f.toRadius / f.fromRadius, k);
        if (f.t >= 1) s.flyAnim = null;
      }
      const sp = Math.sin(s.phi), cp = Math.cos(s.phi);
      camera.position.set(
        s.target.x + s.radius * sp * Math.cos(s.theta),
        s.target.y + s.radius * cp,
        s.target.z + s.radius * sp * Math.sin(s.theta)
      );
      camera.lookAt(s.target);
      camera.near = Math.max(0.02, s.radius * 0.002);
      camera.far = Math.max(300000, s.radius * 10);
      camera.updateProjectionMatrix();

      // labels
      const dense = s.radius;
      labelEls.forEach(({ el: le, star }) => {
        const show = star.nearby ? dense < 400 : dense < 9000 || star.mag < 0.8;
        if (!show) { le.style.display = "none"; return; }
        projTag(le, star.pos);
        le.style.opacity = star.nearby && dense > 150 ? 0.55 : 0.9;
      });
      projTag(sunLabel, new THREE.Vector3(0, 0, 0));
      sunLabel.style.display = dense < 200000 ? sunLabel.style.display : "none";
      projTag(sgrLabel, GAL_CENTER);
      if (dense < 3000) sgrLabel.style.display = "none";
      ringLabels.forEach((rl, i) => {
        const r = ringRadii[i];
        if (dense < r * 0.35 || dense > r * 30) { rl.style.display = "none"; return; }
        projTag(rl, new THREE.Vector3(r * 0.7071, 0, r * 0.7071));
      });

      // halos track selection
      const sel = s.selectedIdx || [];
      [s.haloA, s.haloB].forEach((halo, i) => {
        const idx = sel[i];
        if (idx == null) { halo.visible = false; return; }
        halo.visible = true;
        halo.position.copy(STARS[idx].pos);
        halo.scale.setScalar(s.radius * 0.045);
      });

      setCamDist((prev) => (Math.abs(prev - s.radius) / Math.max(prev, 1) > 0.01 ? s.radius : prev));
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      renderer.dispose();
      mount.removeChild(el);
      labelHost.innerHTML = "";
    };
  }, [flyTo]);

  // keep tether + halos synced with selection
  useEffect(() => {
    const s = stateRef.current;
    s.selectedIdx = selected;
    if (!s.tether) return;
    const pts = s.tether.geometry.attributes.position;
    if (selected.length === 2) {
      const a = STARS[selected[0]].pos, b = STARS[selected[1]].pos;
      pts.setXYZ(0, a.x, a.y, a.z); pts.setXYZ(1, b.x, b.y, b.z);
      pts.needsUpdate = true; s.tether.visible = true;
    } else if (selected.length === 1) {
      const a = STARS[selected[0]].pos;
      pts.setXYZ(0, 0, 0, 0); pts.setXYZ(1, a.x, a.y, a.z);
      pts.needsUpdate = true; s.tether.visible = true;
    } else s.tether.visible = false;
  }, [selected]);

  // ---------------- Derived measurements ----------------
  const A = selected[0] != null ? STARS[selected[0]] : null;
  const B = selected[1] != null ? STARS[selected[1]] : null;
  let sepLy = null, closure = null, journeyFrom = null, journeyTo = null;
  if (A && B) {
    sepLy = A.pos.distanceTo(B.pos);
    // Radial-velocity-only closure estimate: v_i = rv_i * unit(pos_i)
    const u1 = A.pos.clone().normalize(), u2 = B.pos.clone().normalize();
    const v1 = u1.multiplyScalar(A.rv), v2 = u2.multiplyScalar(B.rv);
    const sepU = B.pos.clone().sub(A.pos).normalize();
    closure = sepU.dot(v2.sub(v1)); // km/s; negative = closing
    journeyFrom = A.name; journeyTo = B.name;
  } else if (A) {
    sepLy = A.ly;
    journeyFrom = "Sun"; journeyTo = A.name;
  }
  const trip = sepLy ? journey(sepLy, accel) : null;
  const voyagerYears = sepLy ? (sepLy * C_KMS) / 17 / (60 * 60 * 24 * 365.25) * 1 : null;
  // voyager: time = dist_km / 17 km/s ; dist_km = ly * 9.4607e12
  const voyYears = sepLy ? (sepLy * 9.4607e12) / 17 / 3.15576e7 : null;

  const scaleLabel =
    camDist < 100 ? "the solar neighborhood" :
    camDist < 2500 ? "the naked-eye bubble" :
    camDist < 40000 ? "the Orion Arm" : "the Milky Way";

  const panel = {
    background: "rgba(6,10,20,0.82)",
    border: "1px solid rgba(232,180,90,0.25)",
    backdropFilter: "blur(6px)",
    borderRadius: 6,
  };
  const mono = { fontFamily: "ui-monospace, Menlo, Consolas, monospace" };
  const serif = { fontFamily: "Georgia, 'Times New Roman', serif" };

  const StarCard = ({ st, tag }) => (
    <div style={{ ...panel, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ ...serif, fontSize: 17, color: "#f0e8d8" }}>{st.name}</div>
        <div style={{ ...mono, fontSize: 10, color: AMBER, letterSpacing: "0.15em" }}>{tag}</div>
      </div>
      <div style={{ ...mono, fontSize: 11.5, color: "#9fb0cf", marginTop: 6, lineHeight: 1.7 }}>
        <div>{st.spec} · mag {st.mag.toFixed(2)} · <span style={{ color: SPEC_COLOR[st.spec[0]] }}>●</span></div>
        <div>{fmt(st.ly, 1)} ly from Sun</div>
        <div style={{ color: st.rv < 0 ? ICE : "#e8a07a" }}>
          {st.rv < 0 ? "approaching" : "receding"} at {fmt(Math.abs(st.rv), 1)} km/s
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", minHeight: 560, background: "#04060d", overflow: "hidden", color: "#dfe6f2" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={labelsRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />

      {/* Cartouche */}
      <div style={{ position: "absolute", top: 14, left: 14, ...panel, padding: "12px 16px", maxWidth: 300 }}>
        <div style={{ ...serif, fontSize: 21, letterSpacing: "0.02em", color: "#f0e8d8" }}>Stellar Neighborhood</div>
        <div style={{ ...mono, fontSize: 10, color: AMBER, letterSpacing: "0.22em", marginTop: 2 }}>A NAVIGABLE ATLAS · 1 UNIT = 1 LIGHT-YEAR</div>
        <div style={{ ...mono, fontSize: 11, color: "#8fa0c0", marginTop: 8 }}>
          viewing <span style={{ color: "#dfe6f2" }}>{scaleLabel}</span><br />
          camera {fmt(camDist, camDist < 100 ? 1 : 0)} ly from focus
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {[["Neighborhood", 60], ["Bright stars", 1600], ["Whole galaxy", 95000]].map(([label, r]) => (
            <button key={label} onClick={() => flyTo(new THREE.Vector3(0, 0, 0), r)}
              style={{ ...mono, fontSize: 10.5, padding: "4px 9px", background: "rgba(232,180,90,0.1)", border: "1px solid rgba(232,180,90,0.35)", color: "#e8c88a", borderRadius: 4, cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Selection + journey panel */}
      <div style={{ position: "absolute", top: 14, right: 14, width: 288, maxHeight: "calc(100% - 28px)", overflowY: "auto" }}>
        {A && <StarCard st={A} tag={B ? "ORIGIN" : "SELECTED"} />}
        {B && <StarCard st={B} tag="DESTINATION" />}

        {trip && (
          <div style={{ ...panel, padding: "12px 14px", borderColor: "rgba(232,180,90,0.5)" }}>
            <div style={{ ...mono, fontSize: 10, color: AMBER, letterSpacing: "0.2em" }}>
              MISSION BRIEF · {journeyFrom.toUpperCase()} → {journeyTo.toUpperCase()}
            </div>
            <div style={{ ...serif, fontSize: 24, color: "#f0e8d8", margin: "6px 0 2px" }}>
              {fmt(sepLy, sepLy < 100 ? 2 : 0)} <span style={{ fontSize: 14, color: "#9fb0cf" }}>light-years</span>
            </div>
            {A && B && closure != null && (
              <div style={{ ...mono, fontSize: 11, color: closure < 0 ? ICE : "#e8a07a", marginBottom: 6 }}>
                {closure < 0 ? "closing" : "separating"} at ~{fmt(Math.abs(closure), 1)} km/s
                <span style={{ color: "#66779a" }}> (radial component only)</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 5, margin: "8px 0" }}>
              {[0.5, 1, 2].map((g) => (
                <button key={g} onClick={() => setAccel(g)}
                  style={{ ...mono, fontSize: 11, padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                    background: accel === g ? "rgba(232,180,90,0.28)" : "rgba(232,180,90,0.06)",
                    border: `1px solid rgba(232,180,90,${accel === g ? 0.7 : 0.25})`, color: "#e8c88a" }}>
                  {g} g
                </button>
              ))}
            </div>
            <div style={{ ...mono, fontSize: 12, lineHeight: 2, color: "#c3cfe6" }}>
              <div>ship time <span style={{ float: "right", color: "#fff" }}>{fmtYears(trip.shipYears)}</span></div>
              <div>Earth time <span style={{ float: "right", color: "#fff" }}>{fmtYears(trip.earthYears)}</span></div>
              <div>peak speed <span style={{ float: "right", color: "#fff" }}>{(trip.betaMax * 100).toFixed(trip.betaMax > 0.99 ? 4 : 1)}% c</span></div>
              <div>peak γ <span style={{ float: "right", color: "#fff" }}>{fmt(trip.gammaMax, 2)}×</span></div>
              <div style={{ borderTop: "1px solid rgba(232,180,90,0.2)", marginTop: 4, paddingTop: 4, color: "#66779a", fontSize: 11 }}>
                at Voyager 1 speed <span style={{ float: "right" }}>{fmtYears(voyYears)}</span>
              </div>
            </div>
            <div style={{ ...mono, fontSize: 10, color: "#5a6a8f", marginTop: 8, lineHeight: 1.5 }}>
              Constant-{accel} g brachistochrone: accelerate to midpoint, flip, decelerate. Ship time is what the crew ages.
            </div>
            <button onClick={() => setSelected([])}
              style={{ ...mono, fontSize: 10.5, marginTop: 10, padding: "4px 10px", background: "none", border: "1px solid rgba(143,211,255,0.3)", color: ICE, borderRadius: 4, cursor: "pointer" }}>
              Clear selection
            </button>
          </div>
        )}

        {!A && showHelp && (
          <div style={{ ...panel, padding: "12px 14px" }}>
            <div style={{ ...mono, fontSize: 10, color: AMBER, letterSpacing: "0.2em", marginBottom: 8 }}>HOW TO FLY</div>
            <div style={{ ...mono, fontSize: 11.5, color: "#9fb0cf", lineHeight: 1.9 }}>
              drag — orbit<br />
              scroll / pinch — zoom<br />
              shift-drag / right-drag — pan<br />
              click a star — select it<br />
              click a second star — measure<br />
              double-click — fly there
            </div>
            <div style={{ ...mono, fontSize: 10.5, color: "#5a6a8f", marginTop: 10, lineHeight: 1.6 }}>
              Try: select Sirius, then Betelgeuse. Or zoom all the way out and find us.
            </div>
            <button onClick={() => setShowHelp(false)}
              style={{ ...mono, fontSize: 10, marginTop: 8, padding: "3px 8px", background: "none", border: "1px solid rgba(143,211,255,0.25)", color: "#7f93b8", borderRadius: 4, cursor: "pointer" }}>
              dismiss
            </button>
          </div>
        )}
      </div>

      {/* Hover readout */}
      {hovered != null && (
        <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", ...panel, padding: "6px 14px", ...mono, fontSize: 12, color: "#dfe6f2", whiteSpace: "nowrap" }}>
          {STARS[hovered].name} · {STARS[hovered].spec} · {fmt(STARS[hovered].ly, 1)} ly ·{" "}
          <span style={{ color: STARS[hovered].rv < 0 ? ICE : "#e8a07a" }}>
            {STARS[hovered].rv < 0 ? "−" : "+"}{fmt(Math.abs(STARS[hovered].rv), 1)} km/s
          </span>
        </div>
      )}

      {/* Credits */}
      <div style={{ position: "absolute", bottom: 8, right: 12, ...mono, fontSize: 9.5, color: "#3d4a68", pointerEvents: "none" }}>
        positions from Hipparcos/Gaia parallaxes · galaxy backdrop is illustrative
      </div>
    </div>
  );
}
