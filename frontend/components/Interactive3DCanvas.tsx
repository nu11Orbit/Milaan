"use client";
// components/Interactive3DCanvas.tsx — High-Performance 3D WebGL/Canvas Particle Constellation & Parallax Engine

import { useEffect, useRef } from "react";

interface Particle3D {
  x: number;
  y: number;
  z: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  color: string;
  alpha: number;
}

export default function Interactive3DCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Particle count scaled to screen size for 60-120fps performance
    const PARTICLE_COUNT = Math.min(140, Math.floor((width * height) / 9000));
    const particles: Particle3D[] = [];

    const colors = [
      "rgba(16, 185, 129, ", // Emerald
      "rgba(6, 182, 212, ",  // Cyan
      "rgba(99, 102, 241, ", // Indigo
      "rgba(245, 158, 11, ", // Gold / Amber
    ];

    // Initialize 3D particles in a volumetric cube
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const x = (Math.random() - 0.5) * width * 1.6;
      const y = (Math.random() - 0.5) * height * 1.6;
      const z = Math.random() * 800 + 100;
      particles.push({
        x,
        y,
        z,
        baseX: x,
        baseY: y,
        baseZ: z,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        vz: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 2 + 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.6 + 0.2,
      });
    }

    // Mouse tracking with smooth damping
    const mouse = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      isHovering: false,
    };

    // Scroll velocity tracking
    let lastScrollY = window.scrollY;
    let scrollVelocity = 0;

    const handleMouseMove = (e: MouseEvent) => {
      mouse.targetX = e.clientX - width / 2;
      mouse.targetY = e.clientY - height / 2;
      mouse.isHovering = true;
    };

    const handleMouseLeave = () => {
      mouse.isHovering = false;
    };

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      scrollVelocity = (currentScrollY - lastScrollY) * 0.4;
      lastScrollY = currentScrollY;
    };

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    const fov = 400; // Field of view for 3D perspective projection

    // Render loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Smooth mouse interpolation (spring feel)
      mouse.x += (mouse.targetX - mouse.x) * 0.05;
      mouse.y += (mouse.targetY - mouse.y) * 0.05;

      // Decay scroll velocity
      scrollVelocity *= 0.92;

      const cx = width / 2;
      const cy = height / 2;

      // Render projected 2D coordinates
      const projected: Array<{ x: number; y: number; scale: number; alpha: number; color: string }> = [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Apply natural drift + scroll warp
        p.x += p.vx;
        p.y += p.vy;
        p.z -= p.vz + scrollVelocity;

        // Wrap around bounds
        if (p.z < 50) p.z = 900;
        if (p.z > 900) p.z = 50;
        if (p.x > width * 0.9) p.x = -width * 0.9;
        if (p.x < -width * 0.9) p.x = width * 0.9;
        if (p.y > height * 0.9) p.y = -height * 0.9;
        if (p.y < -height * 0.9) p.y = height * 0.9;

        // Interactive mouse parallax & gravitational push
        const dx = p.x - mouse.x * 0.4;
        const dy = p.y - mouse.y * 0.4;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (mouse.isHovering && dist < 220) {
          const force = (220 - dist) / 220;
          p.x += (dx / dist) * force * 3;
          p.y += (dy / dist) * force * 3;
        }

        // 3D Perspective Projection: (x * fov / z, y * fov / z)
        const scale = fov / (fov + p.z);
        const projX = cx + (p.x - mouse.x * 0.15) * scale;
        const projY = cy + (p.y - mouse.y * 0.15) * scale;

        // Depth fogging
        const depthAlpha = Math.max(0.05, Math.min(0.85, (1 - p.z / 950) * p.alpha));

        projected.push({
          x: projX,
          y: projY,
          scale,
          alpha: depthAlpha,
          color: p.color,
        });

        // Draw particle node
        ctx.beginPath();
        ctx.arc(projX, projY, Math.max(0.8, p.radius * scale * 1.8), 0, Math.PI * 2);
        ctx.fillStyle = `${p.color}${depthAlpha})`;
        ctx.fill();

        // Subtle glow halo on closer nodes
        if (scale > 0.55) {
          ctx.beginPath();
          ctx.arc(projX, projY, p.radius * scale * 4, 0, Math.PI * 2);
          ctx.fillStyle = `${p.color}${depthAlpha * 0.25})`;
          ctx.fill();
        }
      }

      // Draw constellation connecting lines between close projected nodes
      ctx.lineWidth = 0.6;
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const p1 = projected[i];
          const p2 = projected[j];
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);

          if (dist < 110) {
            const lineAlpha = (1 - dist / 110) * Math.min(p1.alpha, p2.alpha) * 0.45;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(16, 185, 129, ${lineAlpha})`;
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 opacity-80"
      aria-hidden="true"
    />
  );
}
