/* ==========================================================================
   Spatial Audio Lab - warstwa immersji Hubu (manifest par. 0).
   Wlaczana tylko na czterech stronach Hubu, przez <body class="hub">.
   Narzedzia tego pliku nie dolaczaja.
   Bez znakow diakrytycznych w komentarzach i stringach - zaden tekst z tego
   pliku nie trafia do interfejsu.
   ========================================================================== */
(function () {
  'use strict';

  var isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var dot = document.getElementById('dot');
  var ring = document.getElementById('ring');
  if (isTouch || !dot || !ring) {
    if (dot) { dot.style.display = 'none'; }
    if (ring) { ring.style.display = 'none'; }
    return;
  }

  var mx = -100, my = -100, rx = -100, ry = -100;

  document.addEventListener('mousemove', function (e) {
    mx = e.clientX;
    my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top = my + 'px';
    if (reduce) {
      ring.style.left = mx + 'px';
      ring.style.top = my + 'px';
    }
  });

  if (!reduce) {
    (function loop() {
      rx += (mx - rx) * 0.1;
      ry += (my - ry) * 0.1;
      ring.style.left = rx + 'px';
      ring.style.top = ry + 'px';
      requestAnimationFrame(loop);
    })();
  }

  var targets = document.querySelectorAll('a, button, .card, summary');
  for (var i = 0; i < targets.length; i++) {
    targets[i].addEventListener('mouseenter', function () { ring.classList.add('hover'); });
    targets[i].addEventListener('mouseleave', function () { ring.classList.remove('hover'); });
  }
})();
