import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { Play, Pause, Upload, Volume2, VolumeX, RotateCcw } from "lucide-react";

/* ═══════════════════════════════════════════
   CONSTANTS & SHAPE DEFINITIONS
   ═══════════════════════════════════════════ */

const VERT_COLORS = [
  "#ff4d6a", "#00e5a0", "#3da0ff", "#ffb83d",
  "#c77dff", "#ff6b35", "#00d4ff", "#7aff5e",
];

const SHAPE_DEFS = {
  circle:   { name: "Koło",     icon: "◯", n: 8, intervals: [1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2] },
  triangle: { name: "Trójkąt",  icon: "△", n: 3, intervals: [1, 5/4, 3/2] },
  square:   { name: "Kwadrat",  icon: "◻", n: 4, intervals: [1, 5/4, 3/2, 15/8] },
  pyramid:  { name: "Piramida", icon: "⬡", n: 5, intervals: [1, 9/8, 5/4, 3/2, 5/3] },
};

const WAVES = [
  { value: "sine",     label: "Sin" },
  { value: "sawtooth", label: "Saw" },
  { value: "square",   label: "Sq" },
  { value: "triangle", label: "Tri" },
];

/* ═══════════════════════════════════════════
   GEOMETRY HELPERS
   ═══════════════════════════════════════════ */

function calcVertices(shape, radius, rotation, elevation) {
  const def = SHAPE_DEFS[shape];
  const verts = [];
  if (shape === "pyramid") {
    for (let i = 0; i < 4; i++) {
      const a = rotation + (i * Math.PI * 2) / 4;
      verts.push({ x: radius * Math.sin(a), y: elevation, z: -radius * Math.cos(a) });
    }
    verts.push({ x: 0, y: elevation + radius * 1.2, z: 0 });
  } else {
    for (let i = 0; i < def.n; i++) {
      const a = rotation + (i * Math.PI * 2) / def.n;
      verts.push({ x: radius * Math.sin(a), y: elevation, z: -radius * Math.cos(a) });
    }
  }
  return verts;
}

function getEdges(shape) {
  const n = SHAPE_DEFS[shape].n;
  if (shape === "pyramid") {
    const e = [];
    for (let i = 0; i < 4; i++) { e.push([i, (i + 1) % 4]); e.push([i, 4]); }
    return e;
  }
  const e = [];
  for (let i = 0; i < n; i++) e.push([i, (i + 1) % n]);
  return e;
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */

export default function SpatialShapeAudio() {
  const [activeShape, setActiveShape] = useState("triangle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveform, setWaveform] = useState("sine");
  const [baseFreq, setBaseFreq] = useState(220);
  const [radius, setRadius] = useState(3);
  const [orbitSpeed, setOrbitSpeed] = useState(0.3);
  const [autoElev, setAutoElev] = useState(true);
  const [elevSpeed, setElevSpeed] = useState(0.4);
  const [elevRange, setElevRange] = useState(2);
  const [masterVol, setMasterVol] = useState(0.5);
  const [sourceType, setSourceType] = useState("synth");
  const [sampleName, setSampleName] = useState(null);
  const [sampleBuffer, setSampleBuffer] = useState(null);

  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const animRef = useRef(null);
  const camAngleRef = useRef({ theta: Math.PI / 4, phi: 1.05 });

  const audioCtxRef = useRef(null);
  const nodesRef = useRef([]);
  const masterRef = useRef(null);

  const rotRef = useRef(0);
  const clockRef = useRef(0);

  // Keep fresh params accessible in animation loop
  const P = useRef({});
  useEffect(() => {
    P.current = { activeShape, radius, orbitSpeed, autoElev, elevSpeed, elevRange, masterVol, baseFreq, waveform, sourceType };
  });

  /* ─── THREE.JS SETUP ─── */
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Force layout to resolve before reading size
    const W = Math.max(container.clientWidth, 400);
    const H = Math.max(container.clientHeight, 300);

    // ── Scene ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06060e);
    scene.fog = new THREE.Fog(0x06060e, 20, 40);

    // ── Camera ──
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    cameraRef.current = camera;

    const updateCam = () => {
      const { theta, phi } = camAngleRef.current;
      const r = 14;
      camera.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
      camera.lookAt(0, 1, 0);
    };
    updateCam();

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── Resize – use ResizeObserver for reliable sizing ──
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 10 || h < 10) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    // ── Grid ──
    scene.add(new THREE.GridHelper(24, 24, 0x1a1a3a, 0x0e0e22));

    // ── Listener head ──
    const lGrp = new THREE.Group();
    lGrp.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xdddde8 })
    ));
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.22, 8),
      new THREE.MeshBasicMaterial({ color: 0x3da0ff })
    );
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.28;
    lGrp.add(nose);
    const earGeo = new THREE.SphereGeometry(0.07, 8, 8);
    const earMat = new THREE.MeshBasicMaterial({ color: 0x888899 });
    const earL = new THREE.Mesh(earGeo, earMat); earL.position.set(-0.2, 0, 0); lGrp.add(earL);
    const earR = new THREE.Mesh(earGeo, earMat); earR.position.set(0.2, 0, 0); lGrp.add(earR);
    lGrp.position.y = 0.18;
    scene.add(lGrp);

    // ── Vertex spheres + glow sprites (max 8) ──
    const vMeshes = [];
    const vGlows = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 16, 16),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(VERT_COLORS[i]) })
      );
      m.visible = false;
      scene.add(m);
      vMeshes.push(m);

      const c = document.createElement("canvas"); c.width = 64; c.height = 64;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, VERT_COLORS[i] + "aa");
      grad.addColorStop(0.4, VERT_COLORS[i] + "44");
      grad.addColorStop(1, VERT_COLORS[i] + "00");
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
      }));
      s.scale.set(1.4, 1.4, 1);
      s.visible = false;
      scene.add(s);
      vGlows.push(s);
    }

    // ── Edge lines ──
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    const edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x3da0ff, transparent: true, opacity: 0.55 }));
    scene.add(edgeLines);

    // ── Orbit ring ──
    const ORBIT_PTS = 65;
    const orbitGeo = new THREE.BufferGeometry();
    orbitGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ORBIT_PTS * 3), 3));
    const orbitLine = new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({ color: 0x3da0ff, transparent: true, opacity: 0.18 }));
    scene.add(orbitLine);

    // ── Shadow lines ──
    const shadowGeo = new THREE.BufferGeometry();
    shadowGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const shadowLines = new THREE.LineSegments(shadowGeo, new THREE.LineBasicMaterial({ color: 0x3da0ff, transparent: true, opacity: 0.1 }));
    scene.add(shadowLines);

    // ── Camera drag ──
    let dragging = false, prevX = 0, prevY = 0;
    const onDown = (e) => {
      dragging = true;
      const ev = e.touches ? e.touches[0] : e;
      prevX = ev.clientX; prevY = ev.clientY;
    };
    const onMove = (e) => {
      if (!dragging) return;
      const ev = e.touches ? e.touches[0] : e;
      camAngleRef.current.theta += (ev.clientX - prevX) * 0.006;
      camAngleRef.current.phi = Math.max(0.3, Math.min(1.45, camAngleRef.current.phi - (ev.clientY - prevY) * 0.006));
      prevX = ev.clientX; prevY = ev.clientY;
      updateCam();
    };
    const onUp = () => { dragging = false; };
    const dom = renderer.domElement;
    dom.addEventListener("mousedown", onDown);
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseup", onUp);
    dom.addEventListener("mouseleave", onUp);
    dom.addEventListener("touchstart", onDown, { passive: true });
    dom.addEventListener("touchmove", onMove, { passive: true });
    dom.addEventListener("touchend", onUp);

    // ── Animation loop ──
    let lastT = performance.now();
    const animate = (now) => {
      animRef.current = requestAnimationFrame(animate);
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      const p = P.current;

      rotRef.current += (p.orbitSpeed || 0) * dt;
      clockRef.current += dt;

      let elev = 0;
      if (p.autoElev) elev = Math.sin(clockRef.current * (p.elevSpeed || 0.4)) * (p.elevRange || 2);

      const verts = calcVertices(p.activeShape || "triangle", p.radius || 3, rotRef.current, elev);
      const edges = getEdges(p.activeShape || "triangle");

      // Vertex meshes + glows
      for (let i = 0; i < 8; i++) {
        const vis = i < verts.length;
        vMeshes[i].visible = vis;
        vGlows[i].visible = vis;
        if (vis) {
          vMeshes[i].position.set(verts[i].x, verts[i].y, verts[i].z);
          vGlows[i].position.set(verts[i].x, verts[i].y, verts[i].z);
          vMeshes[i].scale.setScalar(1 + 0.15 * Math.sin(now * 0.004 + i * 1.8));
          vGlows[i].scale.setScalar(1.2 + 0.4 * Math.sin(now * 0.003 + i * 2.1));
        }
      }

      // Edges
      const ea = edgeGeo.attributes.position.array;
      let ei = 0;
      for (const [a, b] of edges) {
        if (a < verts.length && b < verts.length) {
          ea[ei++] = verts[a].x; ea[ei++] = verts[a].y; ea[ei++] = verts[a].z;
          ea[ei++] = verts[b].x; ea[ei++] = verts[b].y; ea[ei++] = verts[b].z;
        }
      }
      while (ei < ea.length) ea[ei++] = 0;
      edgeGeo.attributes.position.needsUpdate = true;
      edgeGeo.setDrawRange(0, edges.length * 2);

      // Orbit ring
      const oa = orbitGeo.attributes.position.array;
      const cr = p.radius || 3;
      for (let i = 0; i < ORBIT_PTS; i++) {
        const a = (i / (ORBIT_PTS - 1)) * Math.PI * 2;
        oa[i * 3] = cr * Math.sin(a);
        oa[i * 3 + 1] = elev;
        oa[i * 3 + 2] = -cr * Math.cos(a);
      }
      orbitGeo.attributes.position.needsUpdate = true;

      // Shadows
      const sa = shadowGeo.attributes.position.array;
      let si = 0;
      for (const v of verts) {
        sa[si++] = v.x; sa[si++] = v.y; sa[si++] = v.z;
        sa[si++] = v.x; sa[si++] = 0;   sa[si++] = v.z;
      }
      while (si < sa.length) sa[si++] = 0;
      shadowGeo.attributes.position.needsUpdate = true;
      shadowGeo.setDrawRange(0, verts.length * 2);

      // Audio panners
      const nodes = nodesRef.current;
      for (let i = 0; i < nodes.length; i++) {
        if (i < verts.length && nodes[i].panner) {
          try {
            nodes[i].panner.positionX.value = verts[i].x;
            nodes[i].panner.positionY.value = verts[i].y;
            nodes[i].panner.positionZ.value = verts[i].z;
          } catch {
            nodes[i].panner.setPosition(verts[i].x, verts[i].y, verts[i].z);
          }
        }
      }
      if (masterRef.current) masterRef.current.gain.value = p.masterVol ?? 0.5;

      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(animate);

    // ── Cleanup ──
    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      dom.removeEventListener("mousedown", onDown);
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseup", onUp);
      dom.removeEventListener("mouseleave", onUp);
      dom.removeEventListener("touchstart", onDown);
      dom.removeEventListener("touchmove", onMove);
      dom.removeEventListener("touchend", onUp);
      renderer.dispose();
      if (container.contains(dom)) container.removeChild(dom);
    };
  }, []);

  /* ─── AUDIO ENGINE ─── */
  const teardownAudio = useCallback(() => {
    nodesRef.current.forEach((nd) => {
      try { nd.gain.gain.linearRampToValueAtTime(0, (audioCtxRef.current?.currentTime || 0) + 0.03); } catch {}
      setTimeout(() => {
        try { nd.source?.stop?.(); } catch {}
        try { nd.source?.disconnect(); nd.gain?.disconnect(); nd.panner?.disconnect(); } catch {}
      }, 40);
    });
    nodesRef.current = [];
    try { masterRef.current?.disconnect(); } catch {}
    masterRef.current = null;
  }, []);

  const buildAudio = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") ctx.resume();
    teardownAudio();

    const master = ctx.createGain();
    master.gain.value = P.current.masterVol ?? 0.5;
    master.connect(ctx.destination);
    masterRef.current = master;

    const shape = P.current.activeShape || "triangle";
    const def = SHAPE_DEFS[shape];
    const freq = P.current.baseFreq || 220;
    const wave = P.current.waveform || "sine";
    const useSample = P.current.sourceType === "sample" && sampleBuffer;

    for (let i = 0; i < def.n; i++) {
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.maxDistance = 20;
      panner.rolloffFactor = 1;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 0.06);

      let source;
      if (useSample) {
        source = ctx.createBufferSource();
        source.buffer = sampleBuffer;
        source.loop = true;
        source.playbackRate.value = def.intervals[i];
      } else {
        source = ctx.createOscillator();
        source.type = wave;
        source.frequency.value = freq * def.intervals[i];
      }

      source.connect(gain);
      gain.connect(panner);
      panner.connect(master);
      source.start();
      nodesRef.current.push({ source, gain, panner });
    }
  }, [sampleBuffer, teardownAudio]);

  const handlePlay = useCallback(() => { buildAudio(); setIsPlaying(true); }, [buildAudio]);
  const handleStop = useCallback(() => { teardownAudio(); setIsPlaying(false); }, [teardownAudio]);

  // Rebuild audio when key params change while playing
  const prevDepsRef = useRef("");
  useEffect(() => {
    const key = `${activeShape}|${waveform}|${baseFreq}|${sourceType}|${sampleBuffer ? 1 : 0}`;
    if (isPlaying && prevDepsRef.current && prevDepsRef.current !== key) buildAudio();
    prevDepsRef.current = key;
  }, [activeShape, waveform, baseFreq, sourceType, sampleBuffer, isPlaying, buildAudio]);

  // File upload
  const fileRef = useRef(null);
  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const buf = await file.arrayBuffer();
      const decoded = await audioCtxRef.current.decodeAudioData(buf);
      setSampleBuffer(decoded);
      setSampleName(file.name);
      setSourceType("sample");
    } catch { alert("Nie udało się zdekodować pliku audio."); }
  }, []);

  useEffect(() => () => { teardownAudio(); try { audioCtxRef.current?.close(); } catch {} }, [teardownAudio]);

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */

  return (
    <div style={S.root}>

      {/* HEADER */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <div style={{ ...S.dot, background: isPlaying ? "#00e5a0" : "#444460" }} />
          <span style={S.title}>Spatial Shape Audio</span>
          <span style={S.subtitle}>Dźwiękowe figury geometryczne</span>
        </div>
        <div style={S.headphones}>🎧 Załóż słuchawki</div>
      </div>

      {/* MAIN */}
      <div style={S.main}>

        {/* 3D VIEWPORT */}
        <div ref={mountRef} style={S.viewport}>
          <div style={S.hintText}>Przeciągnij aby obrócić widok</div>
        </div>

        {/* SIDEBAR */}
        <div style={S.sidebar}>

          <button onClick={isPlaying ? handleStop : handlePlay} style={{
            ...S.playBtn,
            background: isPlaying
              ? "linear-gradient(135deg, #ff4d6a, #ff2a4a)"
              : "linear-gradient(135deg, #3da0ff, #2070dd)",
            boxShadow: isPlaying ? "0 0 20px #ff4d6a44" : "0 0 20px #3da0ff44",
          }}>
            {isPlaying ? <><Pause size={16} /> Stop</> : <><Play size={16} /> Odtwórz</>}
          </button>

          <Section title="Kształt">
            <div style={S.shapeGrid}>
              {Object.entries(SHAPE_DEFS).map(([key, def]) => (
                <button key={key} onClick={() => setActiveShape(key)} style={{
                  ...S.shapeBtn,
                  borderColor: activeShape === key ? "#3da0ff" : "#1a1a30",
                  background: activeShape === key ? "#3da0ff15" : "transparent",
                  color: activeShape === key ? "#3da0ff" : "#666680",
                }}>
                  <span style={{ fontSize: 18 }}>{def.icon}</span>
                  <span style={{ fontSize: 9, letterSpacing: "0.03em" }}>{def.name}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Źródło dźwięku">
            <div style={S.row}>
              {["synth", "sample"].map((t) => (
                <button key={t} onClick={() => setSourceType(t)} style={{
                  ...S.tabBtn,
                  borderColor: sourceType === t ? "#3da0ff" : "#1a1a30",
                  background: sourceType === t ? "#3da0ff18" : "transparent",
                  color: sourceType === t ? "#3da0ff" : "#666680",
                }}>
                  {t === "synth" ? "Syntezator" : "Sample"}
                </button>
              ))}
            </div>
            {sourceType === "synth" ? (
              <>
                <div style={{ ...S.row, gap: 4 }}>
                  {WAVES.map((w) => (
                    <button key={w.value} onClick={() => setWaveform(w.value)} style={{
                      ...S.waveBtn,
                      borderColor: waveform === w.value ? "#3da0ff" : "#1a1a30",
                      background: waveform === w.value ? "#3da0ff18" : "transparent",
                      color: waveform === w.value ? "#3da0ff" : "#55556a",
                    }}>
                      {w.label}
                    </button>
                  ))}
                </div>
                <Slider label="Częstotliwość" value={baseFreq} onChange={setBaseFreq} min={55} max={880} step={1} unit=" Hz" />
              </>
            ) : (
              <>
                <input ref={fileRef} type="file" accept="audio/*" onChange={handleFile} style={{ display: "none" }} />
                <button onClick={() => fileRef.current?.click()} style={S.uploadBtn}>
                  <Upload size={13} /> {sampleName || "Wybierz plik audio"}
                </button>
              </>
            )}
          </Section>

          <Section title="Przestrzeń">
            <Slider label="Promień" value={radius} onChange={setRadius} min={1} max={8} step={0.1} unit=" m" />
            <Slider label="Prędkość orbity" value={orbitSpeed} onChange={setOrbitSpeed} min={0} max={2} step={0.05} unit=" rad/s" />
          </Section>

          <Section title="Elewacja (wznoszenie)">
            <label style={S.checkLabel}>
              <input type="checkbox" checked={autoElev} onChange={(e) => setAutoElev(e.target.checked)} style={{ accentColor: "#3da0ff" }} />
              Automatyczna
            </label>
            {autoElev && (
              <>
                <Slider label="Prędkość" value={elevSpeed} onChange={setElevSpeed} min={0.1} max={2} step={0.1} />
                <Slider label="Zakres" value={elevRange} onChange={setElevRange} min={0.5} max={5} step={0.1} unit=" m" />
              </>
            )}
          </Section>

          <Section title="Głośność">
            <div style={S.volRow}>
              {masterVol > 0 ? <Volume2 size={14} color="#666680" /> : <VolumeX size={14} color="#666680" />}
              <input type="range" min={0} max={1} step={0.01} value={masterVol}
                onChange={(e) => setMasterVol(Number(e.target.value))} style={S.rangeInput} />
              <span style={S.volLabel}>{Math.round(masterVol * 100)}%</span>
            </div>
          </Section>

          <button onClick={() => { rotRef.current = 0; clockRef.current = 0; camAngleRef.current = { theta: Math.PI / 4, phi: 1.05 }; }}
            style={S.resetBtn}>
            <RotateCcw size={12} /> Reset pozycji
          </button>

        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════ */

function Section({ title, children }) {
  return (
    <div>
      <div style={S.sectionTitle}>{title}</div>
      <div style={S.sectionBody}>{children}</div>
    </div>
  );
}

function Slider({ label, value, onChange, min, max, step, unit }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: "#8888a8" }}>{label}</span>
        <span style={{ color: "#b0b0cc", fontFamily: "monospace" }}>
          {step < 1 ? value.toFixed(1) : value}{unit || ""}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={S.rangeInput} />
    </div>
  );
}

/* ═══════════════════════════════════════════
   STYLES – all inline, zero Tailwind
   ═══════════════════════════════════════════ */

const S = {
  root: {
    position: "fixed", inset: 0,
    display: "flex", flexDirection: "column",
    background: "#06060e", color: "#e0e0f0",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    overflow: "hidden",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 16px", borderBottom: "1px solid #14142a", flexShrink: 0,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: "50%" },
  title: { fontSize: 15, fontWeight: 600, letterSpacing: "0.02em" },
  subtitle: { fontSize: 11, color: "#55556a", marginLeft: 4 },
  headphones: { fontSize: 11, color: "#55556a" },

  main: { display: "flex", flex: 1, overflow: "hidden", minHeight: 0 },

  viewport: {
    flex: 1, position: "relative", cursor: "grab",
    minWidth: 0, minHeight: 0, overflow: "hidden",
  },
  hintText: {
    position: "absolute", bottom: 12, left: 12,
    fontSize: 10, color: "#444460", pointerEvents: "none",
  },

  sidebar: {
    width: 264, borderLeft: "1px solid #14142a",
    overflowY: "auto", padding: 16,
    display: "flex", flexDirection: "column", gap: 20, flexShrink: 0,
  },

  playBtn: {
    width: "100%", padding: "10px 0", borderRadius: 8, border: "none", cursor: "pointer",
    color: "#fff", fontSize: 14, fontWeight: 600,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  },

  shapeGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 },
  shapeBtn: {
    padding: "8px 4px", borderRadius: 6, borderWidth: "1.5px", borderStyle: "solid",
    cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    background: "transparent",
  },

  row: { display: "flex", gap: 6, marginBottom: 10 },

  tabBtn: {
    flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer",
    borderWidth: 1, borderStyle: "solid",
  },
  waveBtn: {
    flex: 1, padding: "5px 0", borderRadius: 5, fontSize: 10, fontWeight: 500, cursor: "pointer",
    borderWidth: 1, borderStyle: "solid",
  },

  uploadBtn: {
    width: "100%", padding: "8px 0", borderRadius: 6,
    border: "1px dashed #2a2a44", background: "transparent",
    color: "#666680", fontSize: 11, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  },

  checkLabel: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, color: "#8888a8" },

  volRow: { display: "flex", alignItems: "center", gap: 8 },
  volLabel: { fontSize: 11, color: "#b0b0cc", fontFamily: "monospace", minWidth: 32, textAlign: "right" },

  rangeInput: { width: "100%", accentColor: "#3da0ff", height: 4, cursor: "pointer", flex: 1 },

  resetBtn: {
    width: "100%", padding: "7px 0", borderRadius: 6, border: "1px solid #1a1a30",
    background: "transparent", color: "#55556a", fontSize: 11, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  },

  sectionTitle: {
    fontSize: 10, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.08em", color: "#55556a", marginBottom: 8,
  },
  sectionBody: { display: "flex", flexDirection: "column", gap: 8 },
};
