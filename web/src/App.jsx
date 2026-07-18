import React, { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { loadCatalog, loadFarField, getStar, STRIDE, CI_SENTINEL } from "./lib/catalog.js";
import { journey, closureRate, separationLy, fmt, fmtYears, KM_PER_LY } from "./lib/physics.js";
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
    starGeo.setAttribute("mag", new THREE.InterleavedBufferAttribute(inter, 1, 6));
    starGeo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    const starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float mag; varying vec3 vColor; varying float vMag;
        void main(){ vColor=color; vMag=mag; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=clamp(15.5-2.2*mag, 1.6, 19.0);
          gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `
        varying vec3 vColor; varying float vMag;
        void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv);
          float core=smoothstep(0.16,0.02,d); float halo=smoothstep(0.5,0.08,d)*0.55;
          float a=clamp(core+halo,0.0,1.0); if(a<0.02) discard;
          a*=1.0-0.55*smoothstep(5.5,9.0,vMag);
          gl_FragColor=vec4(mix(vColor,vec3(1.0),core*0.7),a); }`,
      vertexColors: true,
    });
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
        const mat2 = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
          vertexShader: `
            attribute float absmag; varying vec3 vColor;
            void main(){ vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
              gl_PointSize=clamp(3.2-0.35*absmag,1.0,5.0);
              gl_Position=projectionMatrix*mv; }`,
          fragmentShader: `
            varying vec3 vColor;
            void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv);
              float a=smoothstep(0.5,0.05,d)*0.5; if(a<0.02) discard;
              gl_FragColor=vec4(vColor,a); }`,
        });
        const farPoints = new THREE.Points(geo2, mat2);
        farPoints.frustumCulled = false;
        scene.add(farPoints);
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

    // --- Sun marker (rides the same shader; mag -2 renders as a bright core) ---
    const sunGeo = new THREE.BufferGeometry();
    sunGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    sunGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array([1, 0.95, 0.8]), 3));
    sunGeo.setAttribute("mag", new THREE.BufferAttribute(new Float32Array([-2]), 1));
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
    const ringLabels = ringRadii.map((r) => mkTag(r.toLocaleString() + " ly", "#5a6a8f"));

    // ---------------- Interaction ----------------
    const el = renderer.domElement;
    let drag = null, moved = 0;
    const onDown = (e) => {
      drag = { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey };
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
      for (const i of pickable) {
        const o = i * STRIDE;
        pickVec.set(cat.data[o], cat.data[o + 1], cat.data[o + 2]).project(camera);
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
      if (fpsT >= 1) { setFps(Math.round(frames / fpsT)); frames = 0; fpsT = 0; }
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
        const show =
          star.tier === "bright" ? dense < 9000 || star.mag < 0.8 :
          star.tier === "nearby" ? dense < 400 :
          dense < 150 && star.ly < dense * 6;
        if (!show) { le.style.display = "none"; return; }
        projTag(le, labelPos.set(star.x, star.y, star.z));
        le.style.opacity = star.tier !== "bright" && dense > 150 ? 0.55 : 0.9;
      });
      projTag(sunLabel, labelPos.set(0, 0, 0));
      sunLabel.style.display = dense < 200000 ? sunLabel.style.display : "none";
      projTag(sgrLabel, GAL_CENTER);
      if (dense < 3000) sgrLabel.style.display = "none";
      projTag(edgeLabel, labelPos.set(GAL_CENTER.x, 0, -52000));
      if (dense < 18000) edgeLabel.style.display = "none";
      ringLabels.forEach((rl, i) => {
        const r = ringRadii[i];
        if (dense < r * 0.35 || dense > r * 30) { rl.style.display = "none"; return; }
        projTag(rl, labelPos.set(r * 0.7071, 0, r * 0.7071));
      });

      // halos track selection
      const sel = s.selectedIdx || [];
      [s.haloA, s.haloB].forEach((halo, i) => {
        const idx = sel[i];
        if (idx == null) { halo.visible = false; return; }
        const o = idx * STRIDE;
        halo.visible = true;
        halo.position.set(cat.data[o], cat.data[o + 1], cat.data[o + 2]);
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

  // keep tether + halos synced with selection
  useEffect(() => {
    const s = stateRef.current;
    s.selectedIdx = selected;
    if (!s.tether || !cat) return;
    const pts = s.tether.geometry.attributes.position;
    if (selected.length === 2) {
      const a = getStar(cat, selected[0]), b = getStar(cat, selected[1]);
      pts.setXYZ(0, a.x, a.y, a.z); pts.setXYZ(1, b.x, b.y, b.z);
      pts.needsUpdate = true; s.tether.visible = true;
    } else if (selected.length === 1) {
      const a = getStar(cat, selected[0]);
      pts.setXYZ(0, 0, 0, 0); pts.setXYZ(1, a.x, a.y, a.z);
      pts.needsUpdate = true; s.tether.visible = true;
    } else s.tether.visible = false;
  }, [selected, cat]);

  // ---------------- Derived measurements ----------------
  const A = cat && selected[0] != null ? getStar(cat, selected[0]) : null;
  const B = cat && selected[1] != null ? getStar(cat, selected[1]) : null;
  let sepLy = null, closure = null, journeyFrom = null, journeyTo = null;
  if (A && B) {
    sepLy = separationLy(A, B);
    closure = closureRate(A, B); // full 3D velocity vectors — km/s, negative = closing
    journeyFrom = A.name ?? "origin star"; journeyTo = B.name ?? "destination star";
  } else if (A) {
    sepLy = A.ly;
    journeyFrom = "Sun"; journeyTo = A.name ?? "selected star";
  }
  const trip = sepLy ? journey(sepLy, accel) : null;
  const voyYears = sepLy ? (sepLy * KM_PER_LY) / 17 / 3.15576e7 : null;

  const hoveredStar = cat && hovered != null ? getStar(cat, hovered) : null;

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
        <div style={{ ...serif, fontSize: 17, color: "#f0e8d8" }}>{st.name ?? `Star #${st.i}`}</div>
        <div style={{ ...mono, fontSize: 10, color: AMBER, letterSpacing: "0.15em" }}>{tag}</div>
      </div>
      <div style={{ ...mono, fontSize: 11.5, color: "#9fb0cf", marginTop: 6, lineHeight: 1.7 }}>
        <div>
          {st.spect ?? "spectral class n/a"} · mag {st.mag.toFixed(2)} ·{" "}
          <span style={{ color: rgbToCss(ciToRgb(st.ci, CI_SENTINEL)) }}>●</span>
        </div>
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
                {closure < 0 ? "closing" : "separating"} at {fmt(Math.abs(closure), 1)} km/s
                <span style={{ color: "#66779a" }}> (full 3D velocities)</span>
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
      {hoveredStar && (
        <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", ...panel, padding: "6px 14px", ...mono, fontSize: 12, color: "#dfe6f2", whiteSpace: "nowrap" }}>
          {hoveredStar.name ?? `Star #${hoveredStar.i}`} · {hoveredStar.spect ?? "—"} · {fmt(hoveredStar.ly, 1)} ly ·{" "}
          <span style={{ color: hoveredStar.rv < 0 ? ICE : "#e8a07a" }}>
            {hoveredStar.rv < 0 ? "−" : "+"}{fmt(Math.abs(hoveredStar.rv), 1)} km/s
          </span>
        </div>
      )}

      {/* Credits */}
      <div style={{ position: "absolute", bottom: 8, right: 12, ...mono, fontSize: 9.5, color: "#3d4a68", pointerEvents: "none" }}>
        all stars are real: AT-HYG v3.2 (Gaia DR3 / Hipparcos) · far-field distance uncertainty grows with range · dashed galaxy outline is illustrative
      </div>
    </div>
  );
}
