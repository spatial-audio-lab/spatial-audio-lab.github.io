/* ==========================================================================
   Spatial Audio Lab - pole dzwiekowe w hero (canvas 2D, bez bibliotek).
   Wersja zaakceptowana: 4 zrodla na pochylonych orbitach, slady, promienie
   do sluchacza, nieruchome tlo (horyzont acid + siatka). Bez czol fal.

   Kolory wg manifestu par. 01:
     amber  #FFAB00 - zrodla i ich polozenie w 3D
     cyan   #00E5CC - sluchacz
     acid   #BEFF00 - horyzont pola (marka Hubu)

   Parametry zaszyte na stale, ziarno 20260726.
   Bez znakow diakrytycznych - zaden tekst z tego pliku nie trafia do
   interfejsu, a plik jest ladowany takze przez starsze przegladarki.
   ========================================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('field');
  if (!canvas) { return; }
  var ctx = canvas.getContext('2d');
  if (!ctx) { return; }

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var P = {
    sources: 4,
    orbitSpd: 0.9,
    tilt: 0.45,
    trail: 0.9,
    grid: 0.45
  };
  var SEED = 20260726;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;
  var sources = [], raf = null, running = false;
  var t0 = 0, started = false, pausedAt = 0;

  /* Tlo (horyzont + siatka) jest nieruchome, wiec rysujemy je raz na osobnym
     plotnie i tylko przeklejamy w kazdej klatce. */
  var bg = document.createElement('canvas');
  var bctx = bg.getContext('2d');

  function build() {
    var r = mulberry32(SEED);
    sources = [];
    for (var i = 0; i < P.sources; i++) {
      sources.push({
        rad: 0.42 + r() * 0.5,
        tilt: 0.3 + r() * 0.7,
        rot: (r() - 0.5) * 1.6,
        dir: r() > 0.5 ? 1 : -1,
        base: 0.35 + r() * 0.9,
        ph: r() * Math.PI * 2,
        wob: 0.02 + r() * 0.06,
        wobS: 0.15 + r() * 0.3,
        trail: []
      });
    }
  }

  function resize() {
    var b = canvas.getBoundingClientRect();
    if (!b.width || !b.height) { return; }
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = b.width; H = b.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    bg.width = W * dpr; bg.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2; R = Math.min(W, H) * 0.40;
    drawBg();
  }

  function srcPos(s, t) {
    var a = s.ph + t * s.base * s.dir * P.orbitSpd;
    var rr = R * s.rad * (1 + Math.sin(t * s.wobS + s.ph) * s.wob);
    var x = Math.cos(a) * rr;
    var y = Math.sin(a) * rr * s.tilt * P.tilt * 2;
    var c = Math.cos(s.rot), si = Math.sin(s.rot);
    return { x: cx + x * c - y * si, y: cy + x * si + y * c, z: Math.sin(a) };
  }

  /* ---------- tlo: horyzont pola i siatka odniesienia ---------- */
  function drawBg() {
    bctx.clearRect(0, 0, W, H);
    bctx.lineWidth = 1;

    /* horyzont pola - marka Hubu */
    bctx.strokeStyle = 'rgba(190,255,0,0.13)';
    bctx.beginPath(); bctx.arc(cx, cy, R, 0, Math.PI * 2); bctx.stroke();
    bctx.strokeStyle = 'rgba(190,255,0,0.07)';
    bctx.beginPath(); bctx.ellipse(cx, cy, R, R * 0.26, 0, 0, Math.PI * 2); bctx.stroke();

    /* siatka odniesienia */
    if (P.grid > 0.01) {
      bctx.strokeStyle = 'rgba(240,235,224,' + (0.10 * P.grid).toFixed(3) + ')';
      for (var g = 1; g <= 3; g++) {
        bctx.beginPath(); bctx.arc(cx, cy, R * g / 4, 0, Math.PI * 2); bctx.stroke();
      }
      bctx.setLineDash([4, 8]);
      bctx.beginPath();
      bctx.moveTo(cx, cy - R * 1.05); bctx.lineTo(cx, cy + R * 1.05);
      bctx.moveTo(cx - R * 1.05, cy); bctx.lineTo(cx + R * 1.05, cy);
      bctx.stroke();
      bctx.setLineDash([]);
    }
  }

  function drawListener() {
    ctx.strokeStyle = 'rgba(240,235,224,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,229,204,0.9)';
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- klatka ---------- */
  function frame(now) {
    var t = (now - t0) / 1000;
    var i, s, m, f;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);

    var maxTrail = Math.floor(P.trail * 90);
    for (i = 0; i < sources.length; i++) {
      s = sources[i];
      var p = srcPos(s, t);
      var d = (p.z + 1) / 2;

      s.trail.push({ x: p.x, y: p.y, d: d });
      while (s.trail.length > maxTrail) { s.trail.shift(); }

      ctx.lineWidth = 1;
      for (m = 1; m < s.trail.length; m++) {
        f = m / s.trail.length;
        ctx.strokeStyle = 'rgba(255,171,0,' +
          (f * f * 0.24 * (0.3 + s.trail[m].d * 0.7)).toFixed(4) + ')';
        ctx.beginPath();
        ctx.moveTo(s.trail[m - 1].x, s.trail[m - 1].y);
        ctx.lineTo(s.trail[m].x, s.trail[m].y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(255,171,0,' + (0.06 + d * 0.13).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();

      var rad = 1.7 + d * 1.7;
      var gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 6);
      gr.addColorStop(0, 'rgba(255,171,0,' + (0.16 + d * 0.30).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(255,171,0,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(p.x, p.y, rad * 6, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = 'rgba(255,171,0,' + (0.27 + d * 0.73).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
    }

    drawListener();

    if (running) { raf = requestAnimationFrame(frame); }
  }

  /* klatka statyczna dla osob z ograniczona animacja */
  function still() {
    var t = 26, i, s, m, f, q, pt;

    for (i = 0; i < sources.length; i++) {
      s = sources[i];
      s.trail = [];
      for (q = 40; q >= 0; q--) {
        pt = srcPos(s, t - q * 0.02);
        s.trail.push({ x: pt.x, y: pt.y, d: (pt.z + 1) / 2 });
      }
    }

    drawBg();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);

    for (i = 0; i < sources.length; i++) {
      s = sources[i];
      var p = srcPos(s, t);
      var d = (p.z + 1) / 2;
      ctx.lineWidth = 1;
      for (m = 1; m < s.trail.length; m++) {
        f = m / s.trail.length;
        ctx.strokeStyle = 'rgba(255,171,0,' + (f * f * 0.24).toFixed(4) + ')';
        ctx.beginPath();
        ctx.moveTo(s.trail[m - 1].x, s.trail[m - 1].y);
        ctx.lineTo(s.trail[m].x, s.trail[m].y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,171,0,' + (0.27 + d * 0.73).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.7 + d * 1.7, 0, Math.PI * 2); ctx.fill();
    }

    drawListener();
  }

  function play() {
    if (running) { return; }
    var now = performance.now();
    if (!started) {
      t0 = now;
      started = true;
    } else {
      t0 += now - pausedAt;   /* wznowienie: czas plynie dalej, nie cofa sie */
    }
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (!running) { return; }
    running = false;
    pausedAt = performance.now();
    if (raf) { cancelAnimationFrame(raf); }
  }

  var rTimer;
  window.addEventListener('resize', function () {
    clearTimeout(rTimer);
    rTimer = setTimeout(function () {
      resize();
      if (reduce) { still(); }
    }, 150);
  });

  build();
  resize();

  if (reduce) { still(); return; }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { play(); } else { pause(); }
    }, { threshold: 0 }).observe(canvas);
  } else {
    play();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { pause(); } else { play(); }
  });
})();
