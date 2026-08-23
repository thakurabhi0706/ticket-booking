import { useEffect, useRef } from 'react';

/**
 * Background3D — an ambient 3D particle field rendered on a canvas.
 *
 * Hand-rolled rather than pulled from three.js: the project's dependency policy keeps the
 * client at three production packages, and this needs only a perspective divide and a
 * couple of rotation matrices.
 *
 * Points live in a cube around the origin, spin slowly on Y and X, and are projected to
 * 2D. Near neighbours are joined so the field reads as a constellation rather than noise.
 * Everything is drawn behind the app (fixed, pointer-events:none) so it never intercepts
 * a seat click.
 */

const POINT_COUNT = 150;
const SPREAD = 900;          // half-width of the cube the points occupy
const FOCAL = 700;           // perspective focal length
const LINK_DISTANCE = 132;   // px in screen space, below which two points are joined
const MAX_LINK_CHECKS = 60;  // neighbours scanned per point — keeps the pass O(n·k), not O(n²)

function createPoints() {
  return Array.from({ length: POINT_COUNT }, () => ({
    x: (Math.random() - 0.5) * SPREAD * 2,
    y: (Math.random() - 0.5) * SPREAD * 2,
    z: (Math.random() - 0.5) * SPREAD * 2,
    // A little per-point drift stops the field from looking like one rigid object.
    dx: (Math.random() - 0.5) * 0.22,
    dy: (Math.random() - 0.5) * 0.22,
    dz: (Math.random() - 0.5) * 0.22,
    size: 0.6 + Math.random() * 1.7,
  }));
}

export default function Background3D() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const points = createPoints();
    const projected = new Array(POINT_COUNT);
    let width = 0, height = 0, dpr = 1;
    let frame = null;
    let angleY = 0, angleX = 0;

    // Pointer parallax: the field leans a few degrees toward the cursor.
    let targetTiltX = 0, targetTiltY = 0, tiltX = 0, tiltY = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2); // cap: 3x on a 4K panel is wasted fill
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onPointerMove = (e) => {
      targetTiltY = (e.clientX / window.innerWidth - 0.5) * 0.35;
      targetTiltX = (e.clientY / window.innerHeight - 0.5) * 0.28;
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      tiltX += (targetTiltX - tiltX) * 0.045;
      tiltY += (targetTiltY - tiltY) * 0.045;

      const sinY = Math.sin(angleY + tiltY), cosY = Math.cos(angleY + tiltY);
      const sinX = Math.sin(angleX + tiltX), cosX = Math.cos(angleX + tiltX);

      for (let i = 0; i < POINT_COUNT; i++) {
        const p = points[i];

        p.x += p.dx; p.y += p.dy; p.z += p.dz;
        // Wrap at the cube face so density stays even instead of thinning at the edges.
        if (p.x >  SPREAD) p.x = -SPREAD; else if (p.x < -SPREAD) p.x =  SPREAD;
        if (p.y >  SPREAD) p.y = -SPREAD; else if (p.y < -SPREAD) p.y =  SPREAD;
        if (p.z >  SPREAD) p.z = -SPREAD; else if (p.z < -SPREAD) p.z =  SPREAD;

        // Rotate about Y, then about X.
        const x1 =  p.x * cosY + p.z * sinY;
        const z1 = -p.x * sinY + p.z * cosY;
        const y2 =  p.y * cosX - z1 * sinX;
        const z2 =  p.y * sinX + z1 * cosX;

        // Keep the divisor positive so points behind the camera don't invert on screen.
        const depth = z2 + SPREAD * 1.6;
        const scale = FOCAL / Math.max(depth, 1);

        projected[i] = {
          sx: cx + x1 * scale,
          sy: cy + y2 * scale,
          scale,
          size: p.size * scale,
        };
      }

      // ── Links ────────────────────────────────────────────────
      ctx.lineWidth = 0.7;
      for (let i = 0; i < POINT_COUNT; i++) {
        const a = projected[i];
        const limit = Math.min(i + MAX_LINK_CHECKS, POINT_COUNT);
        for (let j = i + 1; j < limit; j++) {
          const b = projected[j];
          const dx = a.sx - b.sx;
          const dy = a.sy - b.sy;
          const distSq = dx * dx + dy * dy;
          if (distSq > LINK_DISTANCE * LINK_DISTANCE) continue;

          const dist = Math.sqrt(distSq);
          // Fade with both separation and depth, so far links recede instead of flickering.
          const alpha = (1 - dist / LINK_DISTANCE) * 0.16 * Math.min(a.scale, b.scale);
          if (alpha <= 0.004) continue;

          ctx.strokeStyle = `rgba(212, 168, 83, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }

      // ── Points ───────────────────────────────────────────────
      for (let i = 0; i < POINT_COUNT; i++) {
        const p = projected[i];
        const radius = Math.max(p.size, 0.4);
        const alpha = Math.min(0.62, 0.14 + p.scale * 0.42);

        ctx.fillStyle = `rgba(226, 196, 138, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = () => {
      angleY += 0.00085;
      angleX += 0.00042;
      draw();
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame === null) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    };

    // A background animation has no business burning CPU on a hidden tab.
    const onVisibility = () => (document.hidden ? stop() : start());

    resize();

    if (reduceMotion) {
      draw();   // one static frame — the texture without the motion
    } else {
      window.addEventListener('pointermove', onPointerMove);
      document.addEventListener('visibilitychange', onVisibility);
      start();
    }
    window.addEventListener('resize', resize);

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="bg3d" aria-hidden="true">
      <canvas ref={canvasRef} className="bg3d-canvas" />
      {/* Slow-drifting colour wash behind the particles. Pure CSS so it costs no JS frames. */}
      <div className="bg3d-orb bg3d-orb-a" />
      <div className="bg3d-orb bg3d-orb-b" />
      <div className="bg3d-orb bg3d-orb-c" />
      <div className="bg3d-grid" />
      <div className="bg3d-vignette" />
    </div>
  );
}
