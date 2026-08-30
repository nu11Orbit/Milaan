"use client";
// MilaanCanvas.tsx — igloo-style full-bleed immersive canvas
// Wireframe floating geometry + live HUD crosshairs + scroll parallax

import { useEffect, useRef } from "react";

interface WireNode {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number;
}

interface WireFace {
  pts: [number, number, number][];
  rotX: number; rotY: number; rotZ: number;
  rVX: number; rVY: number; rVZ: number;
  cx: number; cy: number; cz: number;
  opacity: number;
}

function project(
  x: number, y: number, z: number,
  fov: number, cx: number, cy: number
): [number, number, number] {
  const sc = fov / (fov + z);
  return [cx + x * sc, cy + y * sc, sc];
}

function rotateXYZ(
  x: number, y: number, z: number,
  rx: number, ry: number, rz: number
): [number, number, number] {
  const y1 = y * Math.cos(rx) - z * Math.sin(rx);
  const z1 = y * Math.sin(rx) + z * Math.cos(rx);
  const x2 = x * Math.cos(ry) + z1 * Math.sin(ry);
  const z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
  const x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
  const y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
  return [x3, y3, z2];
}

function buildPolyhedron(sides: number, s: number): [number, number, number][][] {
  const faces: [number, number, number][][] = [];
  const rings = 3;
  for (let i = 0; i < sides; i++) {
    const a1 = (i / sides) * Math.PI * 2;
    const a2 = ((i + 1) / sides) * Math.PI * 2;
    for (let r = 0; r < rings; r++) {
      const phi1 = (r / rings - 0.5) * Math.PI;
      const phi2 = ((r + 1) / rings - 0.5) * Math.PI;
      const p0: [number, number, number] = [Math.cos(phi1) * Math.cos(a1) * s, Math.sin(phi1) * s, Math.cos(phi1) * Math.sin(a1) * s];
      const p1: [number, number, number] = [Math.cos(phi1) * Math.cos(a2) * s, Math.sin(phi1) * s, Math.cos(phi1) * Math.sin(a2) * s];
      const p2: [number, number, number] = [Math.cos(phi2) * Math.cos(a2) * s, Math.sin(phi2) * s, Math.cos(phi2) * Math.sin(a2) * s];
      const p3: [number, number, number] = [Math.cos(phi2) * Math.cos(a1) * s, Math.sin(phi2) * s, Math.cos(phi2) * Math.sin(a1) * s];
      faces.push([p0, p1, p2]);
      faces.push([p0, p2, p3]);
    }
  }
  return faces;
}

export default function MilaanCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);
    let raf: number;
    let t = 0;

    const mouse = { x: W / 2, y: H / 2, tx: W / 2, ty: H / 2 };

    // Scroll velocity
    let lastScroll = window.scrollY;
    let scrollVel = 0;

    // Build shapes
    const shapes: WireFace[] = [];
    const NUM_SHAPES = 16;
    for (let i = 0; i < NUM_SHAPES; i++) {
      const sides = [4, 5, 6, 7][Math.floor(Math.random() * 4)];
      const s = 40 + Math.random() * 80;
      const polys = buildPolyhedron(sides, s);
      for (const pts of polys) {
        shapes.push({
          pts,
          rotX: Math.random() * Math.PI * 2,
          rotY: Math.random() * Math.PI * 2,
          rotZ: Math.random() * Math.PI * 2,
          rVX: (Math.random() - 0.5) * 0.003,
          rVY: (Math.random() - 0.5) * 0.004,
          rVZ: (Math.random() - 0.5) * 0.002,
          cx: (Math.random() - 0.5) * W * 1.8,
          cy: (Math.random() - 0.5) * H * 1.8,
          cz: Math.random() * 600 + 100,
          opacity: 0.1 + Math.random() * 0.2,
        });
      }
    }

    // Build data nodes
    const NODE_COUNT = 80;
    const nodes: WireNode[] = Array.from({ length: NODE_COUNT }, () => ({
      x: (Math.random() - 0.5) * W * 2,
      y: (Math.random() - 0.5) * H * 2,
      z: Math.random() * 700 + 50,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      vz: (Math.random() - 0.5) * 0.2,
      size: 1 + Math.random() * 2.5,
    }));

    const onMouseMove = (e: MouseEvent) => {
      mouse.tx = e.clientX;
      mouse.ty = e.clientY;
    };
    const onScroll = () => {
      const cur = window.scrollY;
      scrollVel = (cur - lastScroll) * 0.5;
      lastScroll = cur;
    };
    const onResize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    const FOV = 500;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      scrollVel *= 0.9;
      t += 0.007;

      const cx = W / 2;
      const cy = H / 2;
      const prlxX = (mouse.x - cx) * 0.016;
      const prlxY = (mouse.y - cy) * 0.016;

      // ── Wireframe faces ──
      for (const sh of shapes) {
        sh.rotX += sh.rVX;
        sh.rotY += sh.rVY;
        sh.rotZ += sh.rVZ;

        sh.cx += Math.sin(t + sh.rVX * 100) * 0.25;
        sh.cy += Math.cos(t + sh.rVY * 100) * 0.25;
        sh.cz -= scrollVel * 0.8;
        if (sh.cz < 20) sh.cz = 700;
        if (sh.cz > 800) sh.cz = 50;

        const projPts = sh.pts.map(([px, py, pz]) => {
          const [rx, ry] = rotateXYZ(px, py, pz, sh.rotX, sh.rotY, sh.rotZ);
          return project(
            sh.cx + rx - prlxX * (sh.cz / 300),
            sh.cy + ry - prlxY * (sh.cz / 300),
            sh.cz, FOV, cx, cy
          );
        });

        const inView = projPts.some(([ppx, ppy]) =>
          ppx > -200 && ppx < W + 200 && ppy > -200 && ppy < H + 200
        );
        if (!inView) continue;

        const avgSc = projPts.reduce((a, b) => a + b[2], 0) / projPts.length;
        const alpha = Math.min(sh.opacity * avgSc * 2.5, 0.32);

        ctx.beginPath();
        ctx.moveTo(projPts[0][0], projPts[0][1]);
        for (let k = 1; k < projPts.length; k++) ctx.lineTo(projPts[k][0], projPts[k][1]);
        ctx.closePath();
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }

      // ── Data nodes + constellation lines ──
      const proj2D: { px: number; py: number; alpha: number }[] = [];

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.z -= n.vz + scrollVel * 0.4;
        if (n.z < 30) n.z = 750;
        if (n.z > 750) n.z = 30;
        if (Math.abs(n.x) > W) n.x *= -0.9;
        if (Math.abs(n.y) > H) n.y *= -0.9;

        const [px, py, sc] = project(n.x - prlxX, n.y - prlxY, n.z, FOV, cx, cy);
        const alpha = Math.min(0.65, sc * 1.3);
        proj2D.push({ px, py, alpha });

        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.5, n.size * sc), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.5})`;
        ctx.fill();
      }

      ctx.lineWidth = 0.45;
      for (let i = 0; i < proj2D.length; i++) {
        for (let j = i + 1; j < proj2D.length; j++) {
          const a = proj2D[i], b = proj2D[j];
          const d = Math.hypot(a.px - b.px, a.py - b.py);
          if (d < 85) {
            const la = (1 - d / 85) * Math.min(a.alpha, b.alpha) * 0.28;
            ctx.beginPath();
            ctx.moveTo(a.px, a.py);
            ctx.lineTo(b.px, b.py);
            ctx.strokeStyle = `rgba(255,255,255,${la})`;
            ctx.stroke();
          }
        }
      }

      // ── HUD crosshair at mouse ──
      const mx = mouse.x, my = mouse.y;
      const cr = 13;
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(mx - cr - 5, my); ctx.lineTo(mx - 4, my); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx + 4, my); ctx.lineTo(mx + cr + 5, my); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, my - cr - 5); ctx.lineTo(mx, my - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, my + 4); ctx.lineTo(mx, my + cr + 5); ctx.stroke();
      ctx.beginPath(); ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      aria-hidden="true"
    />
  );
}
