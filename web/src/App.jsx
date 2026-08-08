import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import * as THREE from "three";
import { loadCatalog, loadFarField, getStar, STRIDE, CI_SENTINEL } from "./lib/catalog.js";
import { journey, brachAt, closureRate, separationLy, advanceStar, closestApproach, fmt, fmtYears, KM_PER_LY, C_KMS, G_LY_YR2 } from "./lib/physics.js";
import { ciToRgb, rgbToCss } from "./lib/color.js";

/* ============================================================
   STELLAR NEIGHBORHOOD — a navigable atlas (S2)
   Real stars, real distances, real velocity vectors.
   1 scene unit = 1 light-year. Sun at origin.
   Galactic plane = XZ. Galactic center at +X.
   Data: Tier 1 buffer from AT-HYG v3.2 (see pipeline/).
   ============================================================ */

const AMBER = "#e8b45a";
const ICE = "#8fd3ff";
const PICK_MAG_LIMIT = 3.0; // unnamed stars brighter than this are still pickable
const SUN_IDX = -1; // sentinel: an explicit Sun pick inside `selected`, alongside a real star
const sunStar = () => ({ i: SUN_IDX, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ly: 0, rv: 0, name: "Sun" });
const getStarOrSun = (cat, idx) => (idx === SUN_IDX ? sunStar() : getStar(cat, idx));
const KMS_TO_LYYR = 1 / C_KMS; // km/s -> ly/yr, for time-scrub position displacement
const YEARS_PER_SEC = 2500;    // playback rate: a full ±100k sweep takes 80s
const YEARS_MAX = 100000;

// The Orange Tube (S5 test 1): a swept-circle mesh along the straight line
// from `from` to `to`, radius at each point an ILLUSTRATIVE function of
// brachAt's gamma there — wide at gamma=1 (endpoints), narrow at peak gamma.
// Color tapers amber -> white-hot the same way. Returns {positions, colors,
// indices} as plain arrays (caller uploads into a BufferGeometry).
//
// Rings are placed at EQUAL STEPS OF SHIP-TIME, not equal steps of distance.
// Under constant proper acceleration, gamma grows so fast with distance that
// uniform-in-distance sampling dumps nearly the whole radius taper into the
// first few percent of the path — 48 evenly-spaced-by-distance segments put
// maybe 2 of them inside the actual transition, so it renders as a faceted
// cone welded to a cylinder, not a curve. Ship-time is the physically
// meaningful clock here anyway (it's what the crew ages), and it inverts to
// distance-fraction in closed form: shipYears = acosh(gamma)/a, so
// gamma = cosh(a * shipYears), and gamma = 1 + a*D*f gives
// f = (cosh(a*shipYears) - 1) / (a*D). Equal ship-time steps -> dense rings
// near departure/arrival (where a little of the crew's time covers a little
// distance) and sparse rings mid-trip (where a little of their time covers a
// huge distance at near-c) -- exactly where the curve needs the resolution.
const TUBE_SEGMENTS = 48; // along the path, split evenly between the two halves
const TUBE_RADIAL = 12;   // around the circumference
// Travel-Time View (S5 test 2): ship-years to reach each star at `accel`,
// from real (x,y,z) triples packed at `stride`-float intervals starting at
// `offset`. Precomputed once per accel change — acosh (inside journey()) is
// too expensive to run per-vertex, every frame, at 268k points. Reused both
// as a GPU attribute (shader-side morph) and read directly in JS (picking,
// labels — see morphedPos in the scene effect) so both stay exactly in sync.
function computeTravelYears(data, stride, offset, count, accel) {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * stride + offset;
    const d = Math.hypot(data[o], data[o + 1], data[o + 2]);
    out[i] = journey(d, accel).shipYears;
  }
  return out;
}

function buildGammaTube(from, to, D, accel) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-6) return null;
  dir.normalize();
  // Any vector not parallel to dir, then Gram-Schmidt to get an orthonormal pair.
  const seed = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = seed.clone().sub(dir.clone().multiplyScalar(seed.dot(dir))).normalize();
  const v = dir.clone().cross(u);

  const half = brachAt(D, accel, 0.5); // peak gamma + ship-time to reach the midpoint
  const peakGamma = half.gamma;
  const accelLyYr2 = accel * G_LY_YR2;
  const rMax = Math.max(len * 0.018, 0.05);
  const rMin = rMax * 0.08; // never fully closes — a "bright wire", not a seam
  const amberC = new THREE.Color(AMBER), hotC = new THREE.Color(0xfff6e8);

  const HALF = TUBE_SEGMENTS / 2;
  const accelFs = [0];
  for (let i = 1; i <= HALF; i++) {
    const t = half.shipYears * (i / HALF); // even step of ship-time, 0..peak
    const gamma = Math.cosh(accelLyYr2 * t);
    accelFs.push(Math.min(0.5, (gamma - 1) / (accelLyYr2 * D)));
  }
  accelFs[HALF] = 0.5; // exact midpoint, not a cosh round-off
  const fs = accelFs.concat(accelFs.slice(0, -1).reverse().map((f) => 1 - f));

  const positions = [], colors = [];
  for (const f of fs) {
    const gamma = brachAt(D, accel, f).gamma;
    const r = rMin + (rMax - rMin) / gamma;
    const heat = peakGamma > 1 ? (gamma - 1) / (peakGamma - 1) : 0;
    const c = amberC.clone().lerp(hotC, Math.min(1, heat));
    const center = from.clone().addScaledVector(dir, f * len);
    for (let j = 0; j < TUBE_RADIAL; j++) {
      const theta = (j / TUBE_RADIAL) * Math.PI * 2;
      const p = center.clone()
        .addScaledVector(u, Math.cos(theta) * r)
        .addScaledVector(v, Math.sin(theta) * r);
      positions.push(p.x, p.y, p.z);
      colors.push(c.r, c.g, c.b);
    }
  }
  const indices = [];
  for (let i = 0; i < fs.length - 1; i++) {
    for (let j = 0; j < TUBE_RADIAL; j++) {
      const ia = i * TUBE_RADIAL + j, ib = i * TUBE_RADIAL + ((j + 1) % TUBE_RADIAL);
      const ic = ia + TUBE_RADIAL, id = ib + TUBE_RADIAL;
      indices.push(ia, ic, ib, ib, ic, id);
    }
  }

  // Whole-ship-year rings: a literal calendar around the tube. Departure is
  // t=0; arrival is totalShipYears (exactly 2x the ship-time to the
  // midpoint, by the accelerate/decelerate profile's own symmetry). Spacing
  // between consecutive rings IS time dilation made visible — they crowd
  // together near departure/arrival (a year covers little distance yet) and
  // spread far apart near peak gamma (a year covers most of the trip).
  const totalShipYears = 2 * half.shipYears;
  const yearRingPositions = [];
  const YEAR_RING_SEGS = 24;
  for (let yr = 1; yr < totalShipYears; yr++) {
    const onFirstHalf = yr <= half.shipYears;
    const t = onFirstHalf ? yr : totalShipYears - yr;
    const gamma = Math.cosh(accelLyYr2 * t);
    let f = Math.min(0.5, (gamma - 1) / (accelLyYr2 * D));
    if (!onFirstHalf) f = 1 - f;
    const rGamma = brachAt(D, accel, f).gamma;
    const r = rMin + (rMax - rMin) / rGamma;
    const center = from.clone().addScaledVector(dir, f * len);
    for (let j = 0; j < YEAR_RING_SEGS; j++) {
      const t0 = (j / YEAR_RING_SEGS) * Math.PI * 2, t1 = ((j + 1) / YEAR_RING_SEGS) * Math.PI * 2;
      const p0 = center.clone().addScaledVector(u, Math.cos(t0) * r).addScaledVector(v, Math.sin(t0) * r);
      const p1 = center.clone().addScaledVector(u, Math.cos(t1) * r).addScaledVector(v, Math.sin(t1) * r);
      yearRingPositions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
  }
  return { positions, colors, indices, peakGamma, totalShipYears, yearRingPositions };
}

export default function App() {
  const mountRef = useRef(null);
  const labelsRef = useRef(null);
  const stateRef = useRef({});
  const [cat, setCat] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState([]); // star indices, max 2
  const [hovered, setHovered] = useState(null);
  const [accel, setAccel] = useState(1);
  const [camDist, setCamDist] = useState(60);
  const [fps, setFps] = useState(0);
  const [farCount, setFarCount] = useState(0);
  const [showHelp, setShowHelp] = useState(true);
  const [shipView, setShipView] = useState(false); // Traveler's Sky mode
  const [shipFovUi, setShipFovUi] = useState(60);
  const [trip, setTrip] = useState(null);          // { D, name } — static trip facts
  const [tripUi, setTripUi] = useState(null);      // { frac, shipYears, earthYears, beta, gamma }
  const [tripPlaying, setTripPlaying] = useState(false);

  const [showLines, setShowLines] = useState(true);
  const [skyMode, setSkyMode] = useState("all");   // all | eye | gate
  const [gateLy, setGateLy] = useState(100);
  const [navOpen, setNavOpen] = useState(true);
  const [secs, setSecs] = useState({ atlas: true, box: true, origin: true, dest: true, brief: true });
  const [viewOpen, setViewOpen] = useState(true);
  const [tripOpen, setTripOpen] = useState(true);

  const [boxSelectOn, setBoxSelectOn] = useState(false);
  const [boxResults, setBoxResults] = useState(null); // [{idx,name,mag,ly,camDist}] or null
  const [boxSort, setBoxSort] = useState("near");      // near | bright

  // Time scrub — atlas view only (ship view always shows the present; see
  // PLAN.md S4). years: signed offset from now, driven by real 6D velocities.
  const [years, setYears] = useState(0);
  const [yearsPlaying, setYearsPlaying] = useState(false);
  const [timeOpen, setTimeOpen] = useState(true);

  // Travel-Time View (S5 test 2) — a third atlas projection: radial distance
  // from the origin becomes ship-years to reach it at the current accel;
  // angle unchanged. Render-only (see honesty note at the shader) — atlas
  // view only, forced to 0 in ship view, same as the tube.
  const [travelMorph, setTravelMorph] = useState(0); // 0 = real space, 1 = fully morphed
  const [travelOpen, setTravelOpen] = useState(true);

  // animate() lives in a closure — mirror UI choices into the ref
  useEffect(() => { stateRef.current.accel = accel; }, [accel]);
  useEffect(() => { stateRef.current.showLines = showLines; }, [showLines]);
  useEffect(() => { stateRef.current.skyMode = skyMode; }, [skyMode]);
  useEffect(() => { stateRef.current.gateLy = gateLy; }, [gateLy]);
  useEffect(() => { stateRef.current.boxSelect = boxSelectOn; }, [boxSelectOn]);
  useEffect(() => { stateRef.current.years = years; }, [years]);
  useEffect(() => { stateRef.current.travelMorph = travelMorph; }, [travelMorph]);

  // shared by 3D click-picking and the box-select results list: fills the
  // next empty slot, or replaces the older slot once both are full
  const selectStar = useCallback((idx) => {
    setSelected((prev) => {
      if (prev.includes(idx)) return prev.filter((p) => p !== idx);
      if (prev.length >= 2) return [prev[1], idx];
      return [...prev, idx];
    });
  }, []);

  useEffect(() => {
    loadCatalog().then(setCat).catch((e) => setLoadError(String(e)));
  }, []);

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
    if (!cat) return;
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

    // Ship view (Traveler's Sky): camera AT a position looking outward.
    s.mode = "atlas";
    s.shipPos = new THREE.Vector3(0, 0, 0); // the origin — the Sun until enterShip says otherwise
    s.shipYaw = 0; s.shipPitch = 0; s.shipFov = 60;
    s.targetIdx = null;
    s.originIdx = null; // null = Sun; otherwise a tier1 star index the ship departs from
    // SUN_IDX and null both mean "the Sun" — null is the "nothing explicit" default,
    // SUN_IDX is an explicit pick (e.g. from search, or swap moving Sun into a slot).
    // yrs advances a star's position on its real velocity — the Sun (idx null
    // or SUN_IDX) never moves regardless, by definition of the frame.
    const starPos = (idx, yrs = 0) => {
      if (idx == null || idx === SUN_IDX) return new THREE.Vector3(0, 0, 0);
      const o = idx * STRIDE;
      return new THREE.Vector3(
        cat.data[o] + cat.data[o + 3] * yrs * KMS_TO_LYYR,
        cat.data[o + 1] + cat.data[o + 4] * yrs * KMS_TO_LYYR,
        cat.data[o + 2] + cat.data[o + 5] * yrs * KMS_TO_LYYR,
      );
    };
    const nameFor = (idx) => (idx == null || idx === SUN_IDX) ? "Sun" : (cat.nameByIndex.get(idx)?.name ?? `Star #${idx}`);
    s.effYears = 0; // combined epoch — base scrub epoch + Earth-time elapsed on any active trip; see animate()
    s.enterShip = (idx, originIdx = null) => {
      s.targetIdx = idx;
      s.originIdx = originIdx;
      const yrs = s.years ?? 0;
      const originPos = starPos(originIdx, yrs);
      s.shipPos.copy(originPos);
      const rel = starPos(idx, yrs).sub(originPos);
      const len = rel.length();
      s.shipYaw = Math.atan2(rel.z, rel.x);
      s.shipPitch = Math.asin(rel.y / len);
      s.shipFov = 60;
      s.mode = "ship";
      setShipView(true);
    };
    // Landing bakes the trip's Earth-time into the base epoch — "the universe
    // moved on while you were away" isn't just a mission-brief number anymore,
    // it's where you land: the next departure continues from this epoch.
    s.exitShip = () => {
      if (s.trip) {
        s.years = (s.years ?? 0) + brachAt(s.trip.D, s.accel ?? 1, s.trip.frac).earthYears;
        setYears(s.years);
      }
      s.mode = "atlas";
      s.trip = null;
      s.originIdx = null;
      s.shipPos.set(0, 0, 0);
      camera.fov = 55;
      camera.updateProjectionMatrix();
      setShipView(false);
      setTrip(null); setTripUi(null); setTripPlaying(false);
    };
    s.startTrip = () => {
      if (s.mode !== "ship" || s.targetIdx == null) return;
      const from = s.shipPos.clone(); // wherever the ship is currently parked — Sun or origin star
      const to = starPos(s.targetIdx, s.years ?? 0); // fixed at the departure epoch — no mid-flight re-aiming (that's intercept nav, S5)
      s.trip = { from, to, D: to.distanceTo(from), frac: 0, playing: true, durSec: 40 };
      setTrip({ D: s.trip.D, name: nameFor(s.targetIdx), originName: nameFor(s.originIdx) });
      setTripPlaying(true);
    };
    // Swap origin/destination — works before a trip starts (re-parks the ship
    // at the new origin) and mid-trip, playing or paused (flips from/to and
    // mirrors frac -> 1-frac, which lands on the exact same position and
    // gamma by construction — the accelerate-to-midpoint-decelerate profile
    // is symmetric, so this is a relabeling, not a physical discontinuity).
    s.swapView = (newDestIdx, newOriginIdx) => {
      if (s.mode !== "ship") return;
      if (s.trip) {
        const T = s.trip;
        const newFrom = T.to, newTo = T.from;
        T.from = newFrom; T.to = newTo; T.frac = 1 - T.frac;
        s.originIdx = newOriginIdx; s.targetIdx = newDestIdx;
        const rel = newTo.clone().sub(s.shipPos);
        const len = rel.length();
        s.shipYaw = Math.atan2(rel.z, rel.x);
        s.shipPitch = Math.asin(rel.y / len);
        setTrip((t) => (t ? { ...t, name: nameFor(newDestIdx), originName: nameFor(newOriginIdx) } : t));
      } else {
        s.enterShip(newDestIdx, newOriginIdx);
      }
    };
    s.setTripFrac = (f) => {
      if (!s.trip) return;
      s.trip.frac = f; s.trip.playing = false; setTripPlaying(false);
    };
    s.setTripPlaying = (p) => {
      if (!s.trip) return;
      if (p && s.trip.frac >= 1) s.trip.frac = 0; // replay from the top
      s.trip.playing = p; setTripPlaying(p);
    };

    // Time scrub (atlas view only): stars advance on their real 6D velocity
    // (straight-line extrapolation — see advanceStar/closestApproach in
    // physics.js). years=0 is "now"; the shader, picking, labels, tether,
    // and halos all read s.years each frame/interaction — see animate().
    s.setYears = (y) => {
      s.years = Math.max(-YEARS_MAX, Math.min(YEARS_MAX, y));
      s.yearsPlaying = false; setYearsPlaying(false);
      setYears(s.years);
    };
    s.setYearsPlaying = (p) => {
      if (p && s.years >= YEARS_MAX) s.years = -YEARS_MAX; // replay the full sweep
      s.yearsPlaying = p; setYearsPlaying(p);
      if (p) setYears(s.years);
    };

    // --- Star field: one draw call over the whole Tier 1 buffer ---
    const n = cat.count;
    const inter = new THREE.InterleavedBuffer(cat.data, STRIDE);
    const colArr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [r, g, b] = ciToRgb(cat.data[i * STRIDE + 7], CI_SENTINEL);
      colArr[i * 3] = r; colArr[i * 3 + 1] = g; colArr[i * 3 + 2] = b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.InterleavedBufferAttribute(inter, 3, 0));
    starGeo.setAttribute("vel", new THREE.InterleavedBufferAttribute(inter, 3, 3));
    starGeo.setAttribute("mag", new THREE.InterleavedBufferAttribute(inter, 1, 6));
    starGeo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    // Shared star fragment: soft disc + halo, alpha fades with apparent mag,
    // vFade carries the ship-view sky filters (naked-eye limit / range gate).
    const STAR_FRAG = `
      varying vec3 vColor; varying float vMag; varying float vFade;
      void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv);
        float core=smoothstep(0.16,0.02,d); float halo=smoothstep(0.5,0.08,d)*0.55;
        float a=clamp(core+halo,0.0,1.0);
        a*=1.0-0.55*smoothstep(5.5,9.0,vMag);
        a*=vFade;
        if(a<0.02) discard;
        gl_FragColor=vec4(mix(vColor,vec3(1.0),core*0.7),a); }`;
    // Sky filters — work in both modes: uMagLimit culls below the naked-eye
    // threshold as seen from the ship in ship view, or from the Sun (the
    // catalog's real Earth-apparent magnitude) in atlas view; uGate fades
    // stars beyond a chosen distance from the same reference point (a
    // labeled instrument filter, like range gating on radar). mGate/dGate
    // are set per-mode by each material below; fade/vFade always apply.
    const SKY_FILTER = `
      if (uMagLimit < 50.0) fade *= 1.0 - smoothstep(uMagLimit - 1.0, uMagLimit + 0.5, mGate);
      if (uGate > 0.0) fade *= 1.0 - 0.9 * smoothstep(uGate * 0.8, uGate * 1.3, dGate);
      vFade = fade;`;
    // 5/ln(10) — GLSL log() is natural log.
    const LOG10x5 = "2.171472409516";
    // km/s -> ly/yr for the time-scrub position displacement (1 ly/yr = c).
    const KMS_TO_LYYR_GLSL = String(KMS_TO_LYYR);
    const shipUniforms = () => ({
      uShip: { value: 0 },
      uShipPos: { value: new THREE.Vector3() },
      uMagLimit: { value: 99 },
      uGate: { value: 0 },
      uMorph: { value: 0 }, // Travel-Time View: 0 = real space, 1 = fully morphed
    });

    // Tier 1 packs Sun-apparent magnitude; from the ship the apparent mag is
    // m' = m + 5·log10(d_ship / d_sun) — both distances live on the GPU.
    const starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...shipUniforms(), uYears: { value: 0 } },
      vertexShader: `
        uniform float uShip; uniform vec3 uShipPos;
        uniform float uMagLimit; uniform float uGate; uniform float uYears; uniform float uMorph;
        attribute float mag; attribute vec3 vel; attribute float travelYears;
        varying vec3 vColor; varying float vMag; varying float vFade;
        void main(){ vColor=color;
          // Time scrub: straight-line extrapolation on the real 6D velocity
          // (forced to 0 in ship view — see animate()). Every other position
          // use below (dSun, dShip, gl_Position) reads this displaced pos.
          vec3 pos = position + vel * (uYears * ${KMS_TO_LYYR_GLSL});
          // Travel-Time View: blend real position toward direction*travelYears
          // (angle unchanged, radius becomes ship-years to reach it). Render
          // only — forced to 0 in ship view; real physics elsewhere always
          // reads real positions, never this.
          if (uMorph > 0.0001) {
            float dReal = max(length(pos), 1e-6);
            pos *= (1.0 - uMorph) + uMorph * (travelYears / dReal);
          }
          float dSun = max(length(pos), 0.001);
          float m = mag;
          float mGate = m;
          float dGate = dSun;
          float fade = 1.0;
          if (uShip > 0.5) {
            float rawD = distance(pos, uShipPos);
            float dShip = max(rawD, 0.05);
            m = mag + ${LOG10x5} * log(dShip / dSun);
            mGate = m;
            dGate = dShip;
            if (rawD < 0.05) fade = 0.0; // standing on this star — don't render its own point
          }
          ${SKY_FILTER}
          vMag = m;
          vec4 mv=modelViewMatrix*vec4(pos,1.0);
          gl_PointSize=clamp(15.5-2.2*m, 1.6, 19.0);
          gl_Position=projectionMatrix*mv; }`,
      fragmentShader: STAR_FRAG,
      vertexColors: true,
    });
    s.starMat = starMat;
    s.starGeo = starGeo;
    // Absmag-based variant (far field + Sun marker): m' = M + 5·log10(d_pc/10),
    // with d in ly (10 pc = 32.6156 ly). uAtlasSize > 0 pins atlas-mode size.
    const mkAbsmagMat = (atlasSize) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...shipUniforms(), uAtlasSize: { value: atlasSize } },
      vertexShader: `
        uniform float uShip; uniform vec3 uShipPos; uniform float uAtlasSize;
        uniform float uMagLimit; uniform float uGate; uniform float uMorph;
        attribute float absmag; attribute float travelYears;
        varying vec3 vColor; varying float vMag; varying float vFade;
        void main(){ vColor=color;
          vec3 pos = position;
          if (uMorph > 0.0001) {
            float dReal = max(length(pos), 1e-6);
            pos *= (1.0 - uMorph) + uMorph * (travelYears / dReal);
          }
          float dSun = max(length(pos), 0.001);
          float sz; float m; float mGate; float dGate = dSun;
          float fade = 1.0;
          if (uShip > 0.5) {
            float rawD = distance(pos, uShipPos);
            float dShip = max(rawD, 0.05);
            m = absmag + ${LOG10x5} * log(dShip / 32.6156);
            sz = clamp(15.5-2.2*m, 1.0, 19.0);
            mGate = m;
            dGate = dShip;
            if (rawD < 0.05) fade = 0.0; // standing on this star — don't render its own point
          } else {
            m = 4.0;
            sz = uAtlasSize > 0.0 ? uAtlasSize : clamp(3.2-0.35*absmag, 1.0, 5.0);
            // filter-only magnitude: Sun-apparent, doesn't touch the default m/sz/vMag above
            mGate = absmag + ${LOG10x5} * log(dSun / 32.6156);
          }
          ${SKY_FILTER}
          vMag = m;
          vec4 mv=modelViewMatrix*vec4(pos,1.0);
          gl_PointSize=sz;
          gl_Position=projectionMatrix*mv; }`,
      fragmentShader: STAR_FRAG,
      vertexColors: true,
    });
    s.shipMats = [starMat];
    const starPoints = new THREE.Points(starGeo, starMat);
    starPoints.frustumCulled = false;
    scene.add(starPoints);

    // Pickable subset: named stars plus anything bright (screen-space pick
    // over all 123k every mousemove would burn the frame budget).
    const pickable = [];
    for (let i = 0; i < n; i++) {
      if (cat.nameByIndex.has(i) || cat.data[i * STRIDE + 6] <= PICK_MAG_LIMIT) pickable.push(i);
    }
    const starAt = (i) => getStar(cat, i);

    // --- Far field: REAL stars 3,000–50,000 ly out (Tier 2), loaded lazily.
    // Replaces the old procedural pinwheel: every point here is a measured
    // star. The cloud is lopsided and fades with distance — that's honest:
    // dust hides the far side of the galaxy from every survey.
    s.disposed = false;
    loadFarField(cat)
      .then((far) => {
        if (!far || s.disposed) return;
        const inter2 = new THREE.InterleavedBuffer(far.data, 5);
        const col2 = new Float32Array(far.count * 3);
        for (let i = 0; i < far.count; i++) {
          const [r, g, b] = ciToRgb(far.data[i * 5 + 4], CI_SENTINEL);
          col2[i * 3] = r; col2[i * 3 + 1] = g; col2[i * 3 + 2] = b;
        }
        const geo2 = new THREE.BufferGeometry();
        geo2.setAttribute("position", new THREE.InterleavedBufferAttribute(inter2, 3, 0));
        geo2.setAttribute("absmag", new THREE.InterleavedBufferAttribute(inter2, 1, 3));
        geo2.setAttribute("color", new THREE.BufferAttribute(col2, 3));
        const mat2 = mkAbsmagMat(0);
        s.shipMats.push(mat2);
        const farPoints = new THREE.Points(geo2, mat2);
        farPoints.frustumCulled = false;
        scene.add(farPoints);
        s.farGeo = geo2; s.farData = far.data; // for the travel-years recompute effect
        setFarCount(far.count);
      })
      .catch((e) => console.warn("far field unavailable:", e));

    // --- Ghost outline of the Milky Way — illustrative guide, not data.
    // Dashed rings mark the ~100k ly disk edge and the bulge region so the
    // real data sits in context without a fake star field around it.
    const GAL_CENTER = new THREE.Vector3(26660, 0, 0);
    const mkDashedRing = (radius, dash, gap, opacity) => {
      const pts = [];
      for (let a = 0; a <= 256; a++) {
        const t = (a / 256) * Math.PI * 2;
        pts.push(new THREE.Vector3(
          GAL_CENTER.x + Math.cos(t) * radius, 0, GAL_CENTER.z + Math.sin(t) * radius));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(g, new THREE.LineDashedMaterial({
        color: 0x5a6a8f, transparent: true, opacity, dashSize: dash, gapSize: gap, depthWrite: false,
      }));
      line.computeLineDistances();
      return line;
    };
    scene.add(mkDashedRing(52000, 2600, 1800, 0.45)); // disk edge
    scene.add(mkDashedRing(9800, 900, 700, 0.3));     // bulge region

    // --- Constellation / asterism lines — every endpoint is a real tier1
    // star, so the figures deform under pure perspective as the camera moves.
    if (cat.asterisms) {
      const segs = [];
      const segVel = [];
      for (const c of Object.values(cat.asterisms.constellations)) {
        for (const [i, j] of c.lines) {
          segs.push(
            cat.data[i * STRIDE], cat.data[i * STRIDE + 1], cat.data[i * STRIDE + 2],
            cat.data[j * STRIDE], cat.data[j * STRIDE + 1], cat.data[j * STRIDE + 2],
          );
          segVel.push(
            cat.data[i * STRIDE + 3], cat.data[i * STRIDE + 4], cat.data[i * STRIDE + 5],
            cat.data[j * STRIDE + 3], cat.data[j * STRIDE + 4], cat.data[j * STRIDE + 5],
          );
        }
      }
      const astGeo = new THREE.BufferGeometry();
      astGeo.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
      astGeo.setAttribute("vel", new THREE.Float32BufferAttribute(segVel, 3));
      // ShaderMaterial (not LineBasicMaterial) so endpoints can advance on
      // the same real velocities as the stars they connect — figures
      // dissolve under time scrub exactly like the points they join.
      const astMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {
          uYears: { value: 0 },
          uColor: { value: new THREE.Color(0x8fa5d8) },
          uOpacity: { value: 0.55 },
        },
        vertexShader: `
          uniform float uYears; attribute vec3 vel;
          void main(){ vec3 pos = position + vel * (uYears * ${KMS_TO_LYYR_GLSL});
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0); }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uOpacity;
          void main(){ gl_FragColor = vec4(uColor, uOpacity); }`,
      });
      const astLines = new THREE.LineSegments(astGeo, astMat);
      astLines.frustumCulled = false;
      scene.add(astLines);
      s.astMat = astMat; // ship view boosts these — they're the point there
      s.astLines = astLines;
    }

    // --- Sun marker — carries the Sun's REAL absolute magnitude (4.83), so
    // in ship view it fades honestly with distance (mag +4.25 seen from Vega).
    // In atlas mode uAtlasSize pins it to a prominent fixed size.
    const sunGeo = new THREE.BufferGeometry();
    sunGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    sunGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array([1, 0.95, 0.8]), 3));
    sunGeo.setAttribute("absmag", new THREE.BufferAttribute(new Float32Array([4.83]), 1));
    sunGeo.setAttribute("travelYears", new THREE.BufferAttribute(new Float32Array([0]), 1)); // 0 ly away, always
    const sunMat = mkAbsmagMat(16);
    s.shipMats.push(sunMat);
    const sunPoints = new THREE.Points(sunGeo, sunMat);
    sunPoints.frustumCulled = false;
    scene.add(sunPoints);

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

    // --- The Orange Tube (S5 test 1) — a venturi along the mission-brief
    // path, radius an ILLUSTRATIVE function of gamma(f) at each point: wide
    // at the endpoints (gamma≈1), narrowed to a bright wire at peak gamma.
    // Geometry rebuilt on selection/accel change (see the useEffect below);
    // not a per-frame cost. Color rides the same taper: amber (gamma≈1) to
    // white-hot (peak gamma).
    const tubeGeo = new THREE.BufferGeometry();
    const tubeMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    tubeMesh.visible = false;
    tubeMesh.frustumCulled = false;
    scene.add(tubeMesh);
    s.tubeMesh = tubeMesh;

    // Whole-ship-year rings around the tube — a literal calendar. Their
    // SPACING (not their size) carries the story: bunched near departure/
    // arrival, spread wide near peak gamma, since that's exactly where a
    // year of the crew's life stops mapping to much distance at all.
    const yearRingGeo = new THREE.BufferGeometry();
    const yearRingMat = new THREE.LineBasicMaterial({
      color: ICE, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const yearRings = new THREE.LineSegments(yearRingGeo, yearRingMat);
    yearRings.visible = false;
    yearRings.frustumCulled = false;
    scene.add(yearRings);
    s.tubeYearRings = yearRings;

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

    // --- Labels (HTML overlay) — named stars, tiered by prominence ---
    const labelHost = labelsRef.current;
    const labelStars = [...cat.nameByIndex.keys()].map(starAt).map((st) => ({
      ...st,
      tier: st.mag <= 1.7 ? "bright" : st.ly <= 20 ? "nearby" : "faint",
    }));
    const labelEls = labelStars.map((st) => {
      const el = document.createElement("div");
      el.textContent = st.name;
      el.style.cssText = `position:absolute;transform:translate(-50%,-140%);pointer-events:none;
        font:11px ui-monospace,Menlo,monospace;letter-spacing:0.06em;white-space:nowrap;
        color:${st.tier === "bright" ? "#c9d4ea" : "#7f93b8"};text-shadow:0 1px 3px #000;display:none;`;
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
    const edgeLabel = mkTag("MILKY WAY EDGE · ~100,000 LY ACROSS · OUTLINE ILLUSTRATIVE", "#5a6a8f");

    // Ship-view target reticle + offscreen pointer
    const reticle = document.createElement("div");
    reticle.style.cssText = `position:absolute;width:34px;height:34px;border:1.5px solid ${AMBER};
      border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;display:none;
      box-shadow:0 0 12px rgba(232,180,90,0.35);`;
    labelHost.appendChild(reticle);
    const retTag = mkTag("", AMBER);
    const offArrow = document.createElement("div");
    offArrow.textContent = "➤";
    offArrow.style.cssText = `position:absolute;color:${AMBER};font-size:20px;pointer-events:none;
      display:none;text-shadow:0 0 8px rgba(232,180,90,0.6);`;
    labelHost.appendChild(offArrow);
    const ringLabels = ringRadii.map((r) => mkTag(r.toLocaleString() + " ly", "#5a6a8f"));

    // Box-select overlay (god view): drag draws this rectangle instead of
    // orbiting while boxSelect mode is on; on release every tier1 star
    // projecting inside it is listed, nearest/brightest first.
    const boxRectEl = document.createElement("div");
    boxRectEl.style.cssText = `position:absolute;border:1.5px dashed ${AMBER};
      background:rgba(232,180,90,0.08);pointer-events:none;display:none;`;
    labelHost.appendChild(boxRectEl);
    const boxVec = new THREE.Vector3();
    // Travel-Time View morph, applied client-side wherever we need a screen
    // position that matches what the shader is currently drawing (picking,
    // box-select, labels). Real (dx,dy,dz) is kept for anything measured —
    // ly, camDist — only the projected/clicked point gets warped.
    const morphPos = (x, y, z, travelYears, morph) => {
      if (morph <= 0.0001) return [x, y, z];
      const dReal = Math.max(Math.hypot(x, y, z), 1e-6);
      const f = (1 - morph) + morph * (travelYears / dReal);
      return [x * f, y * f, z * f];
    };
    function computeBoxSelect(x1, y1, x2, y2) {
      const rect = el.getBoundingClientRect();
      const left = Math.min(x1, x2) - rect.left, right = Math.max(x1, x2) - rect.left;
      const top = Math.min(y1, y2) - rect.top, bottom = Math.max(y1, y2) - rect.top;
      if (right - left < 4 || bottom - top < 4) return; // ignore accidental micro-drags
      const matches = [];
      const yrs = (s.effYears ?? 0) * KMS_TO_LYYR; // box select is atlas-only, gated at the call site
      const morph = s.travelMorph ?? 0;
      const ty = s.tier1TravelYears;
      for (let i = 0; i < n; i++) {
        const o = i * STRIDE;
        const dx = cat.data[o] + cat.data[o + 3] * yrs;
        const dy = cat.data[o + 1] + cat.data[o + 4] * yrs;
        const dz = cat.data[o + 2] + cat.data[o + 5] * yrs;
        const [px, py, pz] = ty ? morphPos(dx, dy, dz, ty[i], morph) : [dx, dy, dz];
        boxVec.set(px, py, pz).project(camera);
        if (boxVec.z > 1) continue;
        const sx = (boxVec.x * 0.5 + 0.5) * rect.width, sy = (-boxVec.y * 0.5 + 0.5) * rect.height;
        if (sx < left || sx > right || sy < top || sy > bottom) continue;
        const camDist = camera.position.distanceTo(boxVec.set(dx, dy, dz));
        matches.push({
          idx: i, mag: cat.data[o + 6], ly: Math.hypot(dx, dy, dz),
          camDist, name: cat.nameByIndex.get(i)?.name ?? null,
        });
      }
      setBoxResults(matches);
    }

    // ---------------- Interaction ----------------
    const el = renderer.domElement;
    let drag = null, moved = 0;
    const onDown = (e) => {
      drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, btn: e.button, shift: e.shiftKey };
      moved = 0;
    };
    const onMove = (e) => {
      if (!drag) {
        const hit = pick(e.clientX, e.clientY);
        setHovered(hit); el.style.cursor = hit != null ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy);
      const boxDrag = s.boxSelect && s.mode !== "ship" && drag.btn === 0 && !drag.shift;
      if (s.mode === "ship") {
        // Grab-the-sky look-around; sensitivity tracks FOV so zoomed-in
        // panning stays controllable.
        const k = 0.0022 * (s.shipFov / 60);
        s.shipYaw -= dx * k;
        s.shipPitch = Math.max(-1.55, Math.min(1.55, s.shipPitch + dy * k));
      } else if (boxDrag) {
        const rect = el.getBoundingClientRect();
        const left = Math.min(drag.startX, e.clientX) - rect.left, top = Math.min(drag.startY, e.clientY) - rect.top;
        boxRectEl.style.display = "block";
        boxRectEl.style.left = `${left}px`; boxRectEl.style.top = `${top}px`;
        boxRectEl.style.width = `${Math.abs(e.clientX - drag.startX)}px`;
        boxRectEl.style.height = `${Math.abs(e.clientY - drag.startY)}px`;
      } else if (drag.btn === 2 || drag.shift) {
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
        if (hit != null) selectStar(hit);
      } else if (drag && s.boxSelect && s.mode !== "ship" && drag.btn === 0 && !drag.shift) {
        computeBoxSelect(drag.startX, drag.startY, e.clientX, e.clientY);
      }
      boxRectEl.style.display = "none";
      drag = null;
    };
    const onWheel = (e) => {
      e.preventDefault();
      if (s.mode === "ship") {
        s.shipFov = Math.max(25, Math.min(100, s.shipFov * Math.pow(1.0012, e.deltaY)));
        return;
      }
      s.radius *= Math.pow(1.0016, e.deltaY);
      s.radius = Math.max(0.4, Math.min(220000, s.radius));
    };
    const onDbl = (e) => {
      const hit = pick(e.clientX, e.clientY);
      if (hit != null) flyToStar(hit);
    };
    const flyToStar = (idx) => {
      const st = starAt(idx);
      flyTo(new THREE.Vector3(st.x, st.y, st.z), Math.max(3, st.ly * 0.35));
    };
    s.flyToStar = flyToStar;

    function panBy(dx, dy) {
      const scale = s.radius * 0.0016;
      const q = camera.quaternion;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      s.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    }
    const pickVec = new THREE.Vector3();
    function pick(cx, cy) {
      const rect = el.getBoundingClientRect();
      const px = cx - rect.left, py = cy - rect.top;
      let best = null, bestD = 16;
      // Time-scrub displacement (the combined epoch — matches whatever the
      // shader is currently drawing) so hover/click stay station-accurate.
      const yrs = (s.effYears ?? 0) * KMS_TO_LYYR;
      const morph = s.travelMorph ?? 0;
      const ty = s.tier1TravelYears;
      for (const i of pickable) {
        const o = i * STRIDE;
        const x = cat.data[o] + cat.data[o + 3] * yrs;
        const y = cat.data[o + 1] + cat.data[o + 4] * yrs;
        const z = cat.data[o + 2] + cat.data[o + 5] * yrs;
        const [mx, my, mz] = ty ? morphPos(x, y, z, ty[i], morph) : [x, y, z];
        pickVec.set(mx, my, mz).project(camera);
        if (pickVec.z > 1) continue;
        const sx = (pickVec.x * 0.5 + 0.5) * rect.width, sy = (-pickVec.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestD) { bestD = d; best = i; }
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
    let frames = 0, fpsT = 0;
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const projTag = (elTag, wp) => {
      const rect = el.getBoundingClientRect();
      const v = wp.clone().project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { elTag.style.display = "none"; return; }
      elTag.style.display = "block";
      elTag.style.left = `${(v.x * 0.5 + 0.5) * rect.width}px`;
      elTag.style.top = `${(-v.y * 0.5 + 0.5) * rect.height}px`;
    };
    const labelPos = new THREE.Vector3();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      frames++; fpsT += dt;
      if (fpsT >= 1) {
        setFps(Math.round(frames / fpsT)); frames = 0; fpsT = 0;
        if (s.mode === "ship") setShipFovUi(Math.round(s.shipFov));
      }
      if (s.flyAnim) {
        const f = s.flyAnim; f.t += dt / f.dur;
        const k = easeInOut(Math.min(1, f.t));
        s.target.lerpVectors(f.fromTarget, f.toTarget, k);
        s.radius = f.fromRadius * Math.pow(f.toRadius / f.fromRadius, k);
        if (f.t >= 1) s.flyAnim = null;
      }

      // Trip drive: ship position slides along the route; instruments follow.
      if (s.mode === "ship" && s.trip) {
        const T = s.trip;
        if (T.playing) {
          T.frac = Math.min(1, T.frac + dt / T.durSec);
          if (T.frac >= 1) { T.playing = false; setTripPlaying(false); }
        }
        s.shipPos.lerpVectors(T.from, T.to, T.frac);
        s.tripUiT = (s.tripUiT ?? 0) + dt;
        if (s.tripUiT > 0.15) {
          s.tripUiT = 0;
          setTripUi({ frac: T.frac, distLy: T.frac * T.D, ...brachAt(T.D, s.accel ?? 1, T.frac) });
        }
      }
      const shipOn = s.mode === "ship" ? 1 : 0;
      // filters apply in both modes now — ship-relative in ship view, Sun-relative in atlas view
      const magLimit = s.skyMode === "eye" ? 6.5 : 99;
      const gate = s.skyMode === "gate" ? (s.gateLy ?? 100) : 0;
      const morph = shipOn ? 0 : (s.travelMorph ?? 0); // Travel-Time View is atlas-only
      for (const m of s.shipMats) {
        m.uniforms.uShip.value = shipOn;
        m.uniforms.uShipPos.value.copy(s.shipPos);
        m.uniforms.uMagLimit.value = magLimit;
        m.uniforms.uGate.value = gate;
        m.uniforms.uMorph.value = morph;
      }
      // Manual play/slider drive the BASE epoch whenever no trip is active —
      // works in atlas view, and in ship view before departure (previewing
      // different departure epochs). Once a trip starts, Earth-time elapsed
      // takes over automatically below.
      if (!s.trip && s.yearsPlaying) {
        s.years = Math.max(-YEARS_MAX, Math.min(YEARS_MAX, s.years + dt * YEARS_PER_SEC));
        if (Math.abs(s.years) >= YEARS_MAX) { s.yearsPlaying = false; setYearsPlaying(false); }
        s.yearsUiT = (s.yearsUiT ?? 0) + dt;
        if (s.yearsUiT > 0.15) { s.yearsUiT = 0; setYears(s.years); }
      }
      // Combined epoch: base scrub epoch + Earth-time elapsed on any active
      // trip. Single time value read everywhere a position matters — the
      // shader, picking, labels, halos, the reticle, the mission brief.
      const tripEarthYearsNow = s.trip ? brachAt(s.trip.D, s.accel ?? 1, s.trip.frac).earthYears : 0;
      s.effYears = (s.years ?? 0) + tripEarthYearsNow;
      const yrs = s.effYears * KMS_TO_LYYR; // pre-converted for JS-side position math (labels, halos, pick, box-select)
      if (s.starMat) s.starMat.uniforms.uYears.value = s.effYears;
      if (s.astMat) s.astMat.uniforms.uYears.value = s.effYears;
      if (s.astLines) s.astLines.visible = s.showLines !== false;
      if (s.mode === "ship") {
        camera.position.copy(s.shipPos);
        const cpt = Math.cos(s.shipPitch);
        labelPos.set(
          s.shipPos.x + cpt * Math.cos(s.shipYaw),
          s.shipPos.y + Math.sin(s.shipPitch),
          s.shipPos.z + cpt * Math.sin(s.shipYaw)
        );
        camera.lookAt(labelPos);
        camera.fov = s.shipFov;
        camera.near = 0.01;
        camera.far = 400000;
        camera.updateProjectionMatrix();
      } else {
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
      }

      // labels — in ship view use a fixed "neighborhood" density so bright
      // and nearby star labels show; ring/galaxy tags hide themselves.
      const dense = s.mode === "ship" ? 200 : s.radius;
      if (s.astMat) s.astMat.uniforms.uOpacity.value = s.mode === "ship" ? 0.8 : 0.5;

      // ship-view target reticle
      if (s.mode === "ship" && s.targetIdx != null) {
        const tp = starPos(s.targetIdx, s.effYears);
        const v = labelPos.copy(tp).project(camera);
        const rect2 = el.getBoundingClientRect();
        const onScreen = v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
        if (onScreen) {
          reticle.style.display = "block";
          offArrow.style.display = "none";
          reticle.style.left = `${(v.x * 0.5 + 0.5) * rect2.width}px`;
          reticle.style.top = `${(-v.y * 0.5 + 0.5) * rect2.height}px`;
          retTag.textContent = nameFor(s.targetIdx).toUpperCase();
          projTag(retTag, labelPos.copy(tp));
          retTag.style.transform = "translate(-50%, 130%)";
        } else {
          reticle.style.display = "none";
          retTag.style.display = "none";
          let nx = v.x, ny = v.y;
          if (v.z > 1) { nx = -nx; ny = -ny; } // behind the camera: flip
          const mag = Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
          nx = (nx / mag) * 0.88; ny = (ny / mag) * 0.88;
          const deg = (Math.atan2(-ny, nx) * 180) / Math.PI;
          offArrow.style.display = "block";
          offArrow.style.left = `${(nx * 0.5 + 0.5) * rect2.width}px`;
          offArrow.style.top = `${(-ny * 0.5 + 0.5) * rect2.height}px`;
          offArrow.style.transform = `translate(-50%,-50%) rotate(${deg}deg)`;
        }
      } else {
        reticle.style.display = "none";
        offArrow.style.display = "none";
        retTag.style.display = "none";
      }
      labelEls.forEach(({ el: le, star }) => {
        if (s.mode === "ship" && star.i === s.originIdx) { le.style.display = "none"; return; } // can't label the place you're standing
        const show =
          star.tier === "bright" ? dense < 9000 || star.mag < 0.8 :
          star.tier === "nearby" ? dense < 400 :
          dense < 150 && star.ly < dense * 6;
        if (!show) { le.style.display = "none"; return; }
        const [lx, lyy, lz] = s.tier1TravelYears
          ? morphPos(star.x + star.vx * yrs, star.y + star.vy * yrs, star.z + star.vz * yrs, s.tier1TravelYears[star.i], morph)
          : [star.x + star.vx * yrs, star.y + star.vy * yrs, star.z + star.vz * yrs];
        projTag(le, labelPos.set(lx, lyy, lz));
        le.style.opacity = star.tier !== "bright" && dense > 150 ? 0.55 : 0.9;
      });
      if (s.mode === "ship" && s.shipPos.lengthSq() < 0.01) {
        sunLabel.style.display = "none"; // can't label the place you're standing
      } else {
        projTag(sunLabel, labelPos.set(0, 0, 0));
        sunLabel.style.display = dense < 200000 ? sunLabel.style.display : "none";
      }
      // Galactic landmarks are literal light-year distances, not stars with
      // a travel-time reading — meaningless (and misleading) once the atlas
      // radial axis has been re-mapped to ship-years, so hide them in-morph.
      if (morph > 0.0001) {
        sgrLabel.style.display = "none";
        edgeLabel.style.display = "none";
        ringLabels.forEach((rl) => { rl.style.display = "none"; });
      } else {
        projTag(sgrLabel, GAL_CENTER);
        if (dense < 3000) sgrLabel.style.display = "none";
        projTag(edgeLabel, labelPos.set(GAL_CENTER.x, 0, -52000));
        if (dense < 18000) edgeLabel.style.display = "none";
        ringLabels.forEach((rl, i) => {
          const r = ringRadii[i];
          if (dense < r * 0.35 || dense > r * 30) { rl.style.display = "none"; return; }
          projTag(rl, labelPos.set(r * 0.7071, 0, r * 0.7071));
        });
      }

      // halos track selection; tether + Orange Tube are real-distance
      // measurement overlays that would visually detach from the morphed
      // points, so all three hide while Travel-Time View is engaged.
      const sel = s.selectedIdx || [];
      [s.haloA, s.haloB].forEach((halo, i) => {
        const idx = sel[i];
        if (idx == null || s.mode === "ship" || morph > 0.0001) { halo.visible = false; return; }
        halo.visible = true;
        if (idx === SUN_IDX) halo.position.set(0, 0, 0);
        else {
          const o = idx * STRIDE;
          halo.position.set(cat.data[o] + cat.data[o + 3] * yrs, cat.data[o + 1] + cat.data[o + 4] * yrs, cat.data[o + 2] + cat.data[o + 5] * yrs);
        }
        halo.scale.setScalar(s.radius * 0.045);
      });
      if (morph > 0.0001) {
        if (s.tether) s.tether.visible = false;
        if (s.tubeMesh) s.tubeMesh.visible = false;
        if (s.tubeYearRings) s.tubeYearRings.visible = false;
      }

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
      s.disposed = true;
      cancelAnimationFrame(raf); ro.disconnect();
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      renderer.dispose();
      mount.removeChild(el);
      labelHost.innerHTML = "";
    };
  }, [cat, flyTo]);

  // Recompute Travel-Time View's travelYears attribute whenever accel
  // changes (or the far-field buffer finishes its async load — farCount
  // flips from 0 to the real count exactly once). ~268k acosh calls total;
  // fine for a discrete accel-button click, would not be fine per frame.
  useEffect(() => {
    const s = stateRef.current;
    if (!cat || !s.starGeo) return;
    const t1 = computeTravelYears(cat.data, STRIDE, 0, cat.count, accel);
    s.starGeo.setAttribute("travelYears", new THREE.BufferAttribute(t1, 1));
    s.tier1TravelYears = t1; // JS-side mirror for picking/labels — see morphedPos
    if (s.farGeo && s.farData && farCount > 0) {
      const t2 = computeTravelYears(s.farData, 5, 0, farCount, accel);
      s.farGeo.setAttribute("travelYears", new THREE.BufferAttribute(t2, 1));
    }
  }, [cat, accel, farCount]);

  // keep tether + halos synced with selection (and, in atlas view, the
  // current time-scrub epoch — the tether should track where a star
  // actually is "now", not where it sat at the catalog's reference epoch)
  useEffect(() => {
    const s = stateRef.current;
    s.selectedIdx = selected;
    if (!s.tether || !cat) return;
    const pts = s.tether.geometry.attributes.position;
    const yrs = s.mode === "ship" ? 0 : years;
    if (selected.length === 2) {
      const a = advanceStar(getStarOrSun(cat, selected[0]), yrs);
      const b = advanceStar(getStarOrSun(cat, selected[1]), yrs);
      pts.setXYZ(0, a.x, a.y, a.z); pts.setXYZ(1, b.x, b.y, b.z);
      pts.needsUpdate = true; s.tether.visible = true;
    } else if (selected.length === 1) {
      const a = advanceStar(getStarOrSun(cat, selected[0]), yrs);
      pts.setXYZ(0, 0, 0, 0); pts.setXYZ(1, a.x, a.y, a.z);
      pts.needsUpdate = true; s.tether.visible = true;
    } else s.tether.visible = false;
  }, [selected, cat, years]);

  // Rebuild the Orange Tube (S5 test 1) whenever the mission-brief pair or
  // accel changes. Atlas view only — a pre-flight comparison tool, not meant
  // to clutter first-person ship view.
  useEffect(() => {
    const s = stateRef.current;
    if (!s.tubeMesh || !cat) return;
    if (shipView || selected.length === 0) {
      s.tubeMesh.visible = false;
      if (s.tubeYearRings) s.tubeYearRings.visible = false;
      return;
    }
    const yrs = years;
    const endA = advanceStar(getStarOrSun(cat, selected[0]), yrs);
    const from = selected.length === 2 ? new THREE.Vector3(endA.x, endA.y, endA.z) : new THREE.Vector3(0, 0, 0);
    let to;
    if (selected.length === 2) {
      const endB = advanceStar(getStarOrSun(cat, selected[1]), yrs);
      to = new THREE.Vector3(endB.x, endB.y, endB.z);
    } else {
      to = new THREE.Vector3(endA.x, endA.y, endA.z);
    }
    const D = from.distanceTo(to);
    const built = D > 1e-6 ? buildGammaTube(from, to, D, accel) : null;
    if (!built) {
      s.tubeMesh.visible = false;
      if (s.tubeYearRings) s.tubeYearRings.visible = false;
      return;
    }
    const geo = s.tubeMesh.geometry;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(built.positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(built.colors, 3));
    geo.setIndex(built.indices);
    geo.computeVertexNormals();
    s.tubeMesh.visible = true;
    if (s.tubeYearRings) {
      if (built.yearRingPositions.length > 0) {
        const rGeo = s.tubeYearRings.geometry;
        rGeo.setAttribute("position", new THREE.Float32BufferAttribute(built.yearRingPositions, 3));
        rGeo.setIndex(null);
        s.tubeYearRings.visible = true;
      } else {
        s.tubeYearRings.visible = false; // trip under 1 ship-year — no whole-year mark to show
      }
    }
  }, [selected, cat, years, accel, shipView]);

  // ---------------- Derived measurements ----------------
  // Combined epoch (S4.6): base scrub epoch + Earth-time elapsed on an
  // active trip (tripUi.earthYears, already computed by brachAt and
  // throttled to ~150ms — plenty fresh for card text). Cards/brief use a
  // star's position AT that epoch; closest-approach is a fixed fact about
  // the trajectory (computed from the catalog's reference epoch, t=0),
  // independent of wherever the epoch currently sits.
  const tripEarthYearsUi = shipView && trip ? (tripUi?.earthYears ?? 0) : 0;
  const effectiveYears = years + tripEarthYearsUi;
  const rawA = cat && selected[0] != null ? getStarOrSun(cat, selected[0]) : null;
  const rawB = cat && selected[1] != null ? getStarOrSun(cat, selected[1]) : null;
  const A = rawA ? advanceStar(rawA, effectiveYears) : null;
  const B = rawB ? advanceStar(rawB, effectiveYears) : null;
  const approachA = rawA && rawA.i !== SUN_IDX ? closestApproach(rawA) : null;
  const approachB = rawB && rawB.i !== SUN_IDX ? closestApproach(rawB) : null;
  let sepLy = null, closure = null, journeyFrom = null, journeyTo = null;
  if (A && B) {
    sepLy = separationLy(A, B);
    closure = closureRate(A, B); // full 3D velocity vectors — km/s, negative = closing
    journeyFrom = A.name ?? "origin star"; journeyTo = B.name ?? "destination star";
  } else if (A) {
    sepLy = A.ly;
    journeyFrom = "Sun"; journeyTo = A.name ?? "selected star";
  }
  const brief = sepLy ? journey(sepLy, accel) : null;
  const voyYears = sepLy ? (sepLy * KM_PER_LY) / 17 / 3.15576e7 : null;

  const hoveredStar = cat && hovered != null ? advanceStar(getStar(cat, hovered), effectiveYears) : null;

  const scaleLabel =
    camDist < 100 ? "the solar neighborhood" :
    camDist < 2500 ? "the naked-eye bubble" :
    camDist < 40000 ? "the Orion Arm" : "the Milky Way";

  // which zoom-preset bucket the live camera distance currently falls in —
  // geometric midpoints between the three preset radii (60 / 1600 / 95000 ly)
  const zoomPreset = camDist < 309.8 ? 60 : camDist < 12328.8 ? 1600 : 95000;

  const BOX_RESULTS_SHOWN = 40;
  const sortedBoxResults = boxResults
    ? [...boxResults].sort((a, b) => (boxSort === "near" ? a.camDist - b.camDist : a.mag - b.mag))
    : null;

  const panel = {
    background: "rgba(6,10,20,0.82)",
    border: "1px solid rgba(232,180,90,0.25)",
    backdropFilter: "blur(6px)",
    borderRadius: 6,
  };
  const mono = { fontFamily: "ui-monospace, Menlo, Consolas, monospace" };
  const serif = { fontFamily: "Georgia, 'Times New Roman', serif" };

  const StarCard = ({ st, approach }) => (
    <div>
      <div style={{ ...serif, fontSize: 17, color: "#f0e8d8" }}>{st.name ?? `Star #${st.i}`}</div>
      <div style={{ ...mono, fontSize: 11.5, color: "#9fb0cf", marginTop: 4, lineHeight: 1.7 }}>
        <div>
          {st.spect ?? "spectral class n/a"} · mag {st.mag.toFixed(2)} ·{" "}
          <span style={{ color: rgbToCss(ciToRgb(st.ci, CI_SENTINEL)) }}>●</span>
        </div>
        <div>{fmt(st.ly, 1)} ly from Sun</div>
        <div style={{ color: st.rv < 0 ? ICE : "#e8a07a" }}>
          {st.rv < 0 ? "approaching" : "receding"} at {fmt(Math.abs(st.rv), 1)} km/s
        </div>
      </div>
      {approach && (
        <div style={{ ...mono, fontSize: 10.5, color: "#8fa0c0", marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          closest approach <span style={{ color: AMBER }}>{fmt(approach.distanceLy, approach.distanceLy < 10 ? 2 : 1)} ly</span>
          {" "}in <span style={{ color: AMBER }}>{fmt(Math.abs(approach.years), 0)} yr</span>{approach.years < 0 ? " (past)" : ""}
          <button onClick={() => stateRef.current.setYears?.(approach.years)} title="scrub to this epoch"
            style={{ ...mono, fontSize: 9, marginLeft: 6, padding: "1px 6px", background: "none", border: "1px solid rgba(232,180,90,0.4)", color: AMBER, borderRadius: 3, cursor: "pointer" }}>
            jump
          </button>
        </div>
      )}
    </div>
  );

  const SunCard = () => (
    <div>
      <div style={{ ...serif, fontSize: 17, color: "#f0e8d8" }}>Sun</div>
      <div style={{ ...mono, fontSize: 11.5, color: "#9fb0cf", marginTop: 4, lineHeight: 1.7 }}>
        <div>G2V · absmag 4.83 · <span style={{ color: "#fff3e0" }}>●</span></div>
        <div>0 ly · heliocentric reference origin</div>
        <div style={{ color: "#66779a" }}>at rest in this frame, by definition</div>
      </div>
    </div>
  );

  const CardFor = (st, approach) => (st.i === SUN_IDX ? <SunCard /> : <StarCard st={st} approach={approach} />);

  // Name search over the Sun + all 426 named stars — used to set either slot
  // of `selected` directly, including picking the Sun explicitly even when a
  // real star already occupies the other slot (the 3D click model can't do
  // that, since Sun isn't a catalog point).
  const StarSearch = ({ placeholder, excludeIdx, allowSun = false, onPick }) => {
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const results = useMemo(() => {
      if (!cat || q.trim().length === 0) return [];
      const ql = q.trim().toLowerCase();
      const out = [];
      if (allowSun && "sun".startsWith(ql)) out.push({ idx: SUN_IDX, name: "Sun" });
      for (const [k, v] of cat.nameByIndex.entries()) {
        const idx = Number(k);
        if (idx === excludeIdx) continue;
        if (v.name.toLowerCase().startsWith(ql)) out.push({ idx, name: v.name });
        if (out.length >= 8) break;
      }
      return out;
    }, [q, excludeIdx, allowSun]);
    return (
      <div style={{ position: "relative", marginTop: 6 }}>
        <input value={q} placeholder={placeholder}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          style={{ ...mono, fontSize: 11, width: "100%", boxSizing: "border-box", padding: "5px 8px",
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(232,180,90,0.3)",
            borderRadius: 4, color: "#dfe6f2", outline: "none" }} />
        {open && results.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2, zIndex: 5,
            ...panel, padding: "4px 0", maxHeight: 180, overflowY: "auto" }}>
            {results.map((r) => (
              <div key={r.idx}
                onMouseDown={() => { onPick(r.idx); setQ(""); setOpen(false); }}
                style={{ ...mono, fontSize: 11, padding: "5px 10px", cursor: "pointer", color: r.idx === SUN_IDX ? "#fff3e0" : "#dfe6f2" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,180,90,0.15)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                {r.name}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const Section = ({ k, title, children }) => (
    <div style={{ borderTop: "1px solid rgba(232,180,90,0.16)" }}>
      <div onClick={() => setSecs((p) => ({ ...p, [k]: !p[k] }))}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", cursor: "pointer", userSelect: "none", ...mono, fontSize: 10, color: AMBER, letterSpacing: "0.18em" }}>
        <span>{title}</span>
        <span style={{ color: "#8fa0c0" }}>{secs[k] ? "▾" : "▸"}</span>
      </div>
      {secs[k] && <div style={{ padding: "0 14px 12px" }}>{children}</div>}
    </div>
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", minHeight: 560, background: "#04060d", overflow: "hidden", color: "#dfe6f2" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={labelsRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />

      {/* Left console */}
      {!navOpen ? (
        <button onClick={() => setNavOpen(true)} title="open console"
          style={{ position: "absolute", top: 14, left: 14, ...panel, ...mono, fontSize: 16, padding: "7px 12px", color: AMBER, cursor: "pointer" }}>
          ☰
        </button>
      ) : (
      <div style={{ position: "absolute", top: 14, left: 14, width: 302, ...panel, padding: 0, maxHeight: "calc(100vh - 28px)", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 10px" }}>
          <button onClick={() => setNavOpen(false)} title="collapse console"
            style={{ ...mono, fontSize: 14, padding: "3px 9px", background: "none", border: "1px solid rgba(232,180,90,0.35)", color: AMBER, borderRadius: 4, cursor: "pointer" }}>
            ☰
          </button>
          <div>
            <div style={{ ...serif, fontSize: 18, letterSpacing: "0.02em", color: "#f0e8d8" }}>Stellar Neighborhood</div>
            <div style={{ ...mono, fontSize: 8.5, color: AMBER, letterSpacing: "0.2em", marginTop: 1 }}>A NAVIGABLE ATLAS · 1 UNIT = 1 LIGHT-YEAR</div>
          </div>
        </div>

        <Section k="atlas" title={shipView ? "SHIP" : "ATLAS"}>
        <div style={{ ...mono, fontSize: 11, color: "#8fa0c0" }}>
          {cat ? <>
            {cat.count.toLocaleString()} stars{farCount > 0 && <> + {farCount.toLocaleString()} far-field</>} · AT-HYG v3.2<br />
            viewing <span style={{ color: "#dfe6f2" }}>{scaleLabel}</span><br />
            camera {fmt(camDist, camDist < 100 ? 1 : 0)} ly from focus · {fps} fps
          </> : loadError ? (
            <span style={{ color: "#e8a07a" }}>catalog failed to load — run web/scripts/sync-data.mjs<br />{loadError}</span>
          ) : (
            <>loading 123,018 stars…</>
          )}
        </div>
        {shipView && (
          <div style={{ marginTop: 10 }}>
            <div style={{ ...mono, fontSize: 10, color: AMBER, letterSpacing: "0.2em" }}>
              SHIP VIEW · FROM {(journeyFrom ?? "THE SUN").toUpperCase()} · FOV {shipFovUi}°
            </div>
            <div style={{ ...mono, fontSize: 10.5, color: "#8fa0c0", marginTop: 4 }}>
              drag — look around · scroll — zoom field of view
            </div>
            <div style={{ ...mono, fontSize: 10, color: "#66779a", marginTop: 4 }}>
              epoch <span style={{ color: AMBER }}>
                {effectiveYears === 0 ? "NOW" : `T${effectiveYears > 0 ? "+" : "−"}${fmt(Math.abs(effectiveYears), 0)} yr`}
              </span>{!trip && " — set the TIME slider to change your departure epoch"}
            </div>
          </div>
        )}
        </Section>

        {sortedBoxResults && (
          <Section k="box" title="BOX SELECT">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ ...mono, fontSize: 10.5, color: "#8fa0c0" }}>
                {sortedBoxResults.length} star{sortedBoxResults.length === 1 ? "" : "s"} in box
              </div>
              <button onClick={() => setBoxResults(null)}
                style={{ ...mono, fontSize: 9.5, padding: "2px 7px", background: "none", border: "1px solid rgba(143,211,255,0.3)", color: ICE, borderRadius: 4, cursor: "pointer" }}>
                clear
              </button>
            </div>
            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
              {[["near", "NEAREST"], ["bright", "BRIGHTEST"]].map(([k, label]) => (
                <button key={k} onClick={() => setBoxSort(k)}
                  style={{ ...mono, fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                    background: boxSort === k ? "rgba(232,180,90,0.25)" : "rgba(232,180,90,0.05)",
                    border: `1px solid rgba(232,180,90,${boxSort === k ? 0.65 : 0.25})`, color: "#e8c88a" }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {sortedBoxResults.slice(0, BOX_RESULTS_SHOWN).map((r) => (
                <div key={r.idx} onClick={() => selectStar(r.idx)}
                  style={{ ...mono, fontSize: 10.5, padding: "4px 2px", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 6,
                    borderTop: "1px solid rgba(255,255,255,0.06)", color: selected.includes(r.idx) ? AMBER : "#c3cfe6" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name ?? `Star #${r.idx}`}</span>
                  <span style={{ color: "#66779a", flexShrink: 0 }}>mag {fmt(r.mag, 1)} · {fmt(r.camDist, r.camDist < 100 ? 1 : 0)} ly</span>
                </div>
              ))}
            </div>
            {sortedBoxResults.length > BOX_RESULTS_SHOWN && (
              <div style={{ ...mono, fontSize: 9.5, color: "#5a6a8f", marginTop: 4 }}>
                showing nearest {BOX_RESULTS_SHOWN} of {sortedBoxResults.length}
              </div>
            )}
            <div style={{ ...mono, fontSize: 9, color: "#5a6a8f", marginTop: 6 }}>
              distance is from the camera, not the Sun · click a row to select it
            </div>
          </Section>
        )}

        {A && (
          <Section k="origin" title="ORIGIN">
            {B ? CardFor(A, approachA) : <SunCard />}
            <StarSearch placeholder="search stars… (or “Sun”)" allowSun excludeIdx={B ? selected[1] : selected[0]}
              onPick={(idx) => setSelected((prev) => (prev.length === 2 ? [idx, prev[1]] : [idx, prev[0]]))} />
          </Section>
        )}
        {A && (
          <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
            <button
              onClick={() => {
                // Single-selection mode never puts the Sun IN `selected` — it's
                // implicit. Swapping has to make it explicit (via SUN_IDX) so
                // the Sun can land in either slot, same as any real star.
                const oldOriginIdx = B ? selected[0] : SUN_IDX;
                const oldDestIdx = B ? selected[1] : selected[0];
                setSelected([oldDestIdx, oldOriginIdx]);
                if (shipView) stateRef.current.swapView?.(oldOriginIdx, oldDestIdx);
              }}
              title="swap origin and destination"
              style={{ ...mono, fontSize: 10, padding: "3px 10px", background: "none",
                border: "1px solid rgba(232,180,90,0.35)", color: AMBER, borderRadius: 4, cursor: "pointer" }}>
              ⇄ swap
            </button>
          </div>
        )}
        {A && (
          <Section k="dest" title="DESTINATION">
            {CardFor(B ?? A, B ? approachB : approachA)}
            <StarSearch placeholder="search stars…" excludeIdx={B ? selected[0] : null}
              onPick={(idx) => setSelected((prev) => (prev.length === 2 ? [prev[0], idx] : [idx]))} />
          </Section>
        )}

        {brief && (
          <Section k="brief" title="MISSION BRIEF">
            <div style={{ ...mono, fontSize: 10, color: "#8fa0c0", letterSpacing: "0.15em" }}>
              {journeyFrom.toUpperCase()} → {journeyTo.toUpperCase()}
            </div>
            <div style={{ ...serif, fontSize: 24, color: "#f0e8d8", margin: "6px 0 2px" }}>
              {fmt(sepLy, sepLy < 100 ? 2 : 0)} <span style={{ fontSize: 14, color: "#9fb0cf" }}>light-years</span>
            </div>
            {A && B && closure != null && (
              <div style={{ ...mono, fontSize: 11, color: closure < 0 ? ICE : "#e8a07a", marginBottom: 6 }}>
                {closure < 0 ? "closing" : "separating"} at {fmt(Math.abs(closure), 1)} km/s
                <span style={{ color: "#66779a" }}> (full 3D velocities)</span>
              </div>
            )}
            <div style={{ ...mono, fontSize: 12, lineHeight: 2, color: "#c3cfe6", marginTop: 8 }}>
              <div>ship time <span style={{ float: "right", color: "#fff" }}>{fmtYears(brief.shipYears)}</span></div>
              <div>Earth time <span style={{ float: "right", color: "#fff" }}>{fmtYears(brief.earthYears)}</span></div>
              <div>peak speed <span style={{ float: "right", color: "#fff" }}>{(brief.betaMax * 100).toFixed(brief.betaMax > 0.99 ? 4 : 1)}% c</span></div>
              <div>peak γ <span style={{ float: "right", color: "#fff" }}>{fmt(brief.gammaMax, 2)}×</span></div>
              <div style={{ borderTop: "1px solid rgba(232,180,90,0.2)", marginTop: 4, paddingTop: 4, color: "#66779a", fontSize: 11 }}>
                at Voyager 1 speed <span style={{ float: "right" }}>{fmtYears(voyYears)}</span>
              </div>
            </div>
            <div style={{ ...mono, fontSize: 10, color: "#5a6a8f", marginTop: 8, lineHeight: 1.5 }}>
              Constant-{accel} g brachistochrone: accelerate to midpoint, flip, decelerate. Ship time is what the crew ages.
            </div>
          </Section>
        )}
      </div>
      )}

      {/* Right action rail — persistent controls, always visible regardless of console scroll state */}
      <div style={{ position: "absolute", top: 14, right: 14, width: 196, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ ...panel, padding: "9px 10px" }}>
          <div onClick={() => setViewOpen((v) => !v)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: viewOpen ? 7 : 0 }}>
            <span style={{ ...mono, fontSize: 9, color: AMBER, letterSpacing: "0.16em" }}>VIEW</span>
            <span style={{ ...mono, fontSize: 10, color: "#8fa0c0" }}>{viewOpen ? "▾" : "▸"}</span>
          </div>
          {viewOpen && (
            <>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {!shipView && [["Neighborhood", 60], ["Bright stars", 1600], ["Whole galaxy", 95000]].map(([label, r]) => (
                  <button key={label} onClick={() => flyTo(new THREE.Vector3(0, 0, 0), r)}
                    style={{ ...mono, fontSize: 10, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                      background: zoomPreset === r ? "rgba(232,180,90,0.28)" : "rgba(232,180,90,0.1)",
                      border: `1px solid rgba(232,180,90,${zoomPreset === r ? 0.7 : 0.35})`, color: "#e8c88a" }}>
                    {label}
                  </button>
                ))}
                <button onClick={() => setShowLines(!showLines)}
                  style={{ ...mono, fontSize: 10, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                    background: showLines ? "rgba(143,165,216,0.22)" : "rgba(143,165,216,0.05)",
                    border: `1px solid rgba(143,165,216,${showLines ? 0.6 : 0.25})`, color: "#aebde0" }}>
                  lines {showLines ? "on" : "off"}
                </button>
                {[["all", "ALL"], ["eye", "NAKED EYE"], ["gate", "RANGE GATE"]].map(([k, label]) => (
                  <button key={k} onClick={() => setSkyMode(k)}
                    style={{ ...mono, fontSize: 10, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                      background: skyMode === k ? "rgba(232,180,90,0.25)" : "rgba(232,180,90,0.05)",
                      border: `1px solid rgba(232,180,90,${skyMode === k ? 0.65 : 0.25})`, color: "#e8c88a" }}>
                    {label}
                  </button>
                ))}
                {!shipView && (
                  <button onClick={() => setBoxSelectOn((v) => !v)} title="drag a box to list stars in it, nearest or brightest first"
                    style={{ ...mono, fontSize: 10, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                      background: boxSelectOn ? "rgba(143,165,216,0.22)" : "rgba(143,165,216,0.05)",
                      border: `1px solid rgba(143,165,216,${boxSelectOn ? 0.6 : 0.25})`, color: "#aebde0" }}>
                    ⬚ box select
                  </button>
                )}
              </div>
              {boxSelectOn && !shipView && (
                <div style={{ ...mono, fontSize: 9, color: "#5a6a8f", marginTop: 5 }}>
                  drag a box over the sky to list every star in it, even faint ones
                </div>
              )}
              {skyMode === "gate" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                    <input type="range" min="10" max="500" step="10" value={gateLy}
                      onChange={(e) => setGateLy(Number(e.target.value))}
                      style={{ flex: 1, accentColor: AMBER }} />
                    <span style={{ ...mono, fontSize: 10, color: "#9fb0cf", minWidth: 44, textAlign: "right" }}>{gateLy} ly</span>
                  </div>
                  <div style={{ ...mono, fontSize: 9, color: "#5a6a8f", marginTop: 4 }}>
                    fading stars beyond the gate distance from {shipView ? "the ship" : "the Sun"}
                  </div>
                </>
              )}
              {skyMode === "eye" && (
                <div style={{ ...mono, fontSize: 9, color: "#5a6a8f", marginTop: 5 }}>
                  naked-eye stars from {shipView ? "the ship" : "the Sun"} (mag ≤ 6.5)
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ ...panel, padding: "9px 10px" }}>
          <div onClick={() => setTimeOpen((v) => !v)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: timeOpen ? 7 : 0 }}>
            <span style={{ ...mono, fontSize: 9, color: AMBER, letterSpacing: "0.16em" }}>TIME</span>
            <span style={{ ...mono, fontSize: 10, color: "#8fa0c0" }}>{timeOpen ? "▾" : "▸"}</span>
          </div>
          {timeOpen && (
            <>
              <div style={{ ...serif, fontSize: 15, color: "#f0e8d8", textAlign: "center" }}>
                {effectiveYears === 0 ? "NOW" : `T${effectiveYears > 0 ? "+" : "−"}${fmt(Math.abs(effectiveYears), 0)} yr`}
              </div>
              {trip ? (
                <div style={{ ...mono, fontSize: 9.5, color: "#8fa0c0", marginTop: 5, textAlign: "center" }}>
                  advancing with Earth-time · departed at {years === 0 ? "NOW" : `T${years > 0 ? "+" : "−"}${fmt(Math.abs(years), 0)} yr`}
                </div>
              ) : (
                <>
                  <input type="range" min={-YEARS_MAX} max={YEARS_MAX} step="100" value={years}
                    onChange={(e) => stateRef.current.setYears?.(Number(e.target.value))}
                    style={{ width: "100%", accentColor: AMBER, marginTop: 6 }} />
                  <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                    <button onClick={() => stateRef.current.setYearsPlaying?.(!yearsPlaying)}
                      style={{ ...mono, fontSize: 11, width: 26, padding: "3px 0", background: "rgba(232,180,90,0.18)", border: "1px solid rgba(232,180,90,0.6)", color: "#f0d9a8", borderRadius: 4, cursor: "pointer" }}>
                      {yearsPlaying ? "⏸" : "▶"}
                    </button>
                    {[["now", 0], ["−100k", -YEARS_MAX], ["+100k", YEARS_MAX]].map(([label, y]) => (
                      <button key={label} onClick={() => stateRef.current.setYears?.(y)}
                        style={{ ...mono, fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                          background: years === y ? "rgba(232,180,90,0.28)" : "rgba(232,180,90,0.06)",
                          border: `1px solid rgba(232,180,90,${years === y ? 0.7 : 0.25})`, color: "#e8c88a" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ ...mono, fontSize: 9, color: "#5a6a8f", marginTop: 5 }}>
                    stars advance on real 6D velocities{shipView ? " · this is your departure epoch" : ""}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {!shipView && (
          <div style={{ ...panel, padding: "9px 10px" }}>
            <div onClick={() => setTravelOpen((v) => !v)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: travelOpen ? 7 : 0 }}>
              <span style={{ ...mono, fontSize: 9, color: AMBER, letterSpacing: "0.16em" }}>TRAVEL-TIME VIEW</span>
              <span style={{ ...mono, fontSize: 10, color: "#8fa0c0" }}>{travelOpen ? "▾" : "▸"}</span>
            </div>
            {travelOpen && (
              <>
                <input type="range" min="0" max="100" step="1" value={Math.round(travelMorph * 100)}
                  onChange={(e) => setTravelMorph(Number(e.target.value) / 100)}
                  style={{ width: "100%", accentColor: AMBER, marginTop: 2 }} />
                <div style={{ ...mono, fontSize: 10, color: "#9fb0cf", marginTop: 4, textAlign: "center" }}>
                  {travelMorph === 0 ? "real space" : `${Math.round(travelMorph * 100)}% morphed to ship-years`}
                </div>
                <div style={{ ...mono, fontSize: 9, color: "#5a6a8f", marginTop: 5 }}>
                  radial distance becomes ship-years to reach at {accel}g brachistochrone — render-only; tether, tube and halos hide while engaged
                </div>
              </>
            )}
          </div>
        )}

        {selected.length > 0 && (
          <div style={{ ...panel, padding: "9px 10px" }}>
            <div style={{ ...mono, fontSize: 9, color: AMBER, letterSpacing: "0.16em", marginBottom: 7 }}>SELECTION</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {!shipView && brief && (
                <button onClick={() => stateRef.current.enterShip?.(selected[1] ?? selected[0], B ? selected[0] : null)}
                  style={{ ...mono, fontSize: 10, padding: "4px 8px",
                    background: "rgba(232,180,90,0.22)", border: "1px solid rgba(232,180,90,0.7)",
                    color: "#f0d9a8", borderRadius: 4, cursor: "pointer" }}>
                  ◉ Ship view → {(journeyTo ?? "").toUpperCase()}
                </button>
              )}
              <button onClick={() => setSelected([])}
                style={{ ...mono, fontSize: 10, padding: "4px 8px", background: "none", border: "1px solid rgba(143,211,255,0.3)", color: ICE, borderRadius: 4, cursor: "pointer" }}>
                Clear selection
              </button>
            </div>
          </div>
        )}

        {brief && (
          <div style={{ ...panel, padding: "9px 10px" }}>
            <div style={{ ...mono, fontSize: 9, color: AMBER, letterSpacing: "0.16em", marginBottom: 7 }}>ACCELERATION</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[0.5, 1, 2].map((g) => (
                <button key={g} onClick={() => setAccel(g)}
                  style={{ ...mono, fontSize: 11, padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                    background: accel === g ? "rgba(232,180,90,0.28)" : "rgba(232,180,90,0.06)",
                    border: `1px solid rgba(232,180,90,${accel === g ? 0.7 : 0.25})`, color: "#e8c88a" }}>
                  {g} g
                </button>
              ))}
            </div>
          </div>
        )}

        {shipView && (
          <div style={{ ...panel, padding: "9px 10px" }}>
            <div onClick={() => setTripOpen((v) => !v)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: tripOpen ? 7 : 0 }}>
              <span style={{ ...mono, fontSize: 9, color: AMBER, letterSpacing: "0.16em" }}>TRIP</span>
              <span style={{ ...mono, fontSize: 10, color: "#8fa0c0" }}>{tripOpen ? "▾" : "▸"}</span>
            </div>
            {tripOpen && <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {!trip && (
                <button onClick={() => stateRef.current.startTrip?.()}
                  style={{ ...mono, fontSize: 10.5, padding: "5px 10px",
                    background: "rgba(232,180,90,0.22)", border: "1px solid rgba(232,180,90,0.7)",
                    color: "#f0d9a8", borderRadius: 4, cursor: "pointer" }}>
                  ▶ Start trip · {accel} g
                </button>
              )}
              <button onClick={() => stateRef.current.exitShip?.()}
                style={{ ...mono, fontSize: 10, padding: "4px 8px", background: "none", border: "1px solid rgba(143,211,255,0.3)", color: ICE, borderRadius: 4, cursor: "pointer" }}>
                ← Back to atlas
              </button>
            </div>}
          </div>
        )}
      </div>

      {/* Help — centered overlay, first run only */}
      {showHelp && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,13,0.55)", zIndex: 10 }}
          onClick={() => setShowHelp(false)}>
          <div style={{ ...panel, padding: "18px 22px", width: 320 }} onClick={(e) => e.stopPropagation()}>
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
              style={{ ...mono, fontSize: 10, marginTop: 12, padding: "5px 10px", background: "none", border: "1px solid rgba(143,211,255,0.35)", color: "#7f93b8", borderRadius: 4, cursor: "pointer" }}>
              dismiss
            </button>
          </div>
        </div>
      )}

      {/* Trip instrument bar */}
      {shipView && trip && (
        <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", ...panel, padding: "10px 16px", width: 620, borderColor: "rgba(232,180,90,0.5)" }}>
          <div style={{ ...mono, fontSize: 10, color: AMBER, letterSpacing: "0.2em" }}>
            TRIP · {trip.originName.toUpperCase()} → {trip.name.toUpperCase()} · {fmt(trip.D, 2)} LY · CONSTANT {accel} g
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <button onClick={() => stateRef.current.setTripPlaying?.(!tripPlaying)}
              style={{ ...mono, fontSize: 13, width: 34, padding: "3px 0", background: "rgba(232,180,90,0.18)", border: "1px solid rgba(232,180,90,0.6)", color: "#f0d9a8", borderRadius: 4, cursor: "pointer" }}>
              {tripPlaying ? "⏸" : "▶"}
            </button>
            <input type="range" min="0" max="1000" value={Math.round((tripUi?.frac ?? 0) * 1000)}
              onChange={(e) => stateRef.current.setTripFrac?.(Number(e.target.value) / 1000)}
              style={{ flex: 1, accentColor: AMBER }} />
            <span style={{ ...mono, fontSize: 11, color: "#9fb0cf", minWidth: 64, textAlign: "right" }}>
              {fmt(tripUi?.distLy ?? 0, 1)} ly
            </span>
          </div>
          {tripUi && (
            <div style={{ ...mono, fontSize: 11.5, color: "#c3cfe6", display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span>ship <span style={{ color: "#fff" }}>{fmtYears(tripUi.shipYears)}</span></span>
              <span>Earth <span style={{ color: "#fff" }}>{fmtYears(tripUi.earthYears)}</span></span>
              <span>speed <span style={{ color: "#fff" }}>{(tripUi.beta * 100).toFixed(tripUi.beta > 0.99 ? 3 : 1)}% c</span></span>
              <span>γ <span style={{ color: "#fff" }}>{fmt(tripUi.gamma, 2)}×</span></span>
              {tripUi.frac >= 1 && <span style={{ color: AMBER }}>ARRIVED</span>}
            </div>
          )}
          <div style={{ ...mono, fontSize: 10, color: "#66779a", marginTop: 6, textAlign: "center" }}>
            epoch <span style={{ color: AMBER }}>
              {effectiveYears === 0 ? "NOW" : `T${effectiveYears > 0 ? "+" : "−"}${fmt(Math.abs(effectiveYears), 0)} yr`}
            </span> — the sky outside keeps moving on real velocities while you fly
          </div>
        </div>
      )}

      {/* Hover readout */}
      {hoveredStar && (
        <div style={{ position: "absolute", bottom: shipView && trip ? 118 : 16, left: "50%", transform: "translateX(-50%)", ...panel, padding: "6px 14px", ...mono, fontSize: 12, color: "#dfe6f2", whiteSpace: "nowrap" }}>
          {hoveredStar.name ?? `Star #${hoveredStar.i}`} · {hoveredStar.spect ?? "—"} · {fmt(hoveredStar.ly, 1)} ly ·{" "}
          <span style={{ color: hoveredStar.rv < 0 ? ICE : "#e8a07a" }}>
            {hoveredStar.rv < 0 ? "−" : "+"}{fmt(Math.abs(hoveredStar.rv), 1)} km/s
          </span>
        </div>
      )}

      {/* Credits */}
      <div style={{ position: "absolute", bottom: 8, right: 12, ...mono, fontSize: 9.5, color: "#3d4a68", pointerEvents: "none" }}>
        all stars are real: AT-HYG v3.2 (Gaia DR3 / Hipparcos) · far-field distance uncertainty grows with range · dashed galaxy outline is illustrative · time scrub moves only tier1 stars on real 6D velocities — far field and Sun held fixed · in flight, the epoch advances with Earth-time, not ship-time · the mission-brief tube's width is an illustrative function of γ, not a real spatial unit · the rings around it mark whole ship-years — their spacing, not their size, is the point · Travel-Time View remaps radial distance to ship-years at the current accel and never touches real positions used for measurement
      </div>
    </div>
  );
}
