"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Milaan3DScrollytelling() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // ── 1. Setup Scene ──
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.05);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 10);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 1);

    const group = new THREE.Group();
    scene.add(group);

    // ── 2. Particle System Geometry ──
    const PARTICLE_COUNT = 2500;
    
    // Arrays for different states
    const posChaos = new Float32Array(PARTICLE_COUNT * 3);
    const posGrid = new Float32Array(PARTICLE_COUNT * 3);
    const posSphere = new Float32Array(PARTICLE_COUNT * 3);
    const posCube = new Float32Array(PARTICLE_COUNT * 3);
    const posCurrent = new Float32Array(PARTICLE_COUNT * 3);

    const sizes = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;

      // State 1: Chaos (Nebula)
      const rChaos = 15;
      posChaos[i3] = (Math.random() - 0.5) * rChaos;
      posChaos[i3 + 1] = (Math.random() - 0.5) * rChaos;
      posChaos[i3 + 2] = (Math.random() - 0.5) * rChaos;

      // State 2: Bipartite Grids (Two distinct parallel walls)
      const isBank = i % 2 === 0;
      const xGrid = isBank ? -4 : 4; // Two distinct walls
      const yGrid = (Math.random() - 0.5) * 12;
      const zGrid = (Math.random() - 0.5) * 12;
      posGrid[i3] = xGrid + (Math.random() * 1 - 0.5); // Add slight fuzz
      posGrid[i3 + 1] = yGrid;
      posGrid[i3 + 2] = zGrid;

      // State 3: Sphere / Neural Net
      const phi = Math.acos(-1 + (2 * i) / PARTICLE_COUNT);
      const theta = Math.sqrt(PARTICLE_COUNT * Math.PI) * phi;
      const rSphere = 5;
      posSphere[i3] = rSphere * Math.cos(theta) * Math.sin(phi);
      posSphere[i3 + 1] = rSphere * Math.sin(theta) * Math.sin(phi);
      posSphere[i3 + 2] = rSphere * Math.cos(phi);

      // State 4: Perfect Matrix Cube
      const cubeSize = Math.ceil(Math.pow(PARTICLE_COUNT, 1 / 3));
      const x = i % cubeSize;
      const y = Math.floor(i / cubeSize) % cubeSize;
      const z = Math.floor(i / (cubeSize * cubeSize));
      const step = 0.8;
      const offset = (cubeSize * step) / 2;
      posCube[i3] = x * step - offset;
      posCube[i3 + 1] = y * step - offset;
      posCube[i3 + 2] = z * step - offset;

      // Init current to Chaos
      posCurrent[i3] = posChaos[i3];
      posCurrent[i3 + 1] = posChaos[i3 + 1];
      posCurrent[i3 + 2] = posChaos[i3 + 2];

      sizes[i] = Math.random() * 2.0 + 1.0; // Random particle sizes (much larger)
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(posCurrent, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    // Custom Shader Material for glowing points
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color: { value: new THREE.Color(0x3b82f6) }, // Neon Blue
        progress: { value: 0 }, // 0 to 1 scroll progress
      },
      vertexShader: `
        attribute float size;
        uniform float time;
        varying float vAlpha;
        
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          
          // Make points pulse based on their position and time
          float pulse = sin(time * 2.0 + position.x * 0.5) * 0.5 + 0.5;
          vAlpha = 0.4 + pulse * 0.6;
          
          gl_PointSize = size * (800.0 / -mvPosition.z) * (1.0 + pulse * 0.5);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vAlpha;
        void main() {
          // Circular particle
          float r = distance(gl_PointCoord, vec2(0.5, 0.5));
          if (r > 0.5) discard;
          
          // Soft glow
          float glow = 1.0 - (r * 2.0);
          glow = pow(glow, 1.5); // sharpen center
          
          gl_FragColor = vec4(color, glow * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, material);
    group.add(particles);

    // ── 3. Scroll & Morph Logic ──
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    const startTime = performance.now();
    let animId: number;

    const lerp = (start: number, end: number, t: number) => {
      return start * (1 - t) + end * t;
    };

    const animate = () => {
      const time = (performance.now() - startTime) / 1000;
      material.uniforms.time.value = time;

      // Calculate total scroll percentage (0.0 to 1.0)
      const currentScrollY = window.scrollY || 0;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const scrollProgress = Math.min(Math.max(currentScrollY / maxScroll, 0), 1);
      material.uniforms.progress.value = scrollProgress;

      // Group overall rotation based on scroll to make it dynamic
      group.rotation.y = time * 0.05 + scrollProgress * Math.PI * 2;
      group.rotation.x = Math.sin(time * 0.1) * 0.1 + scrollProgress * Math.PI;

      // Update Particle Positions (Morphing)
      const positions = geometry.attributes.position.array as Float32Array;
      
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        
        let targetX = 0;
        let targetY = 0;
        let targetZ = 0;

        // Stage definitions
        // 0.0 - 0.25: Chaos to Grid
        // 0.25 - 0.6: Grid to Sphere
        // 0.6 - 1.0: Sphere to Cube
        
        if (scrollProgress < 0.25) {
          const t = scrollProgress / 0.25;
          const easeT = t * t * (3.0 - 2.0 * t); // smoothstep
          targetX = lerp(posChaos[i3], posGrid[i3], easeT);
          targetY = lerp(posChaos[i3+1], posGrid[i3+1], easeT);
          targetZ = lerp(posChaos[i3+2], posGrid[i3+2], easeT);
        } else if (scrollProgress < 0.6) {
          const t = (scrollProgress - 0.25) / 0.35;
          const easeT = t * t * (3.0 - 2.0 * t);
          targetX = lerp(posGrid[i3], posSphere[i3], easeT);
          targetY = lerp(posGrid[i3+1], posSphere[i3+1], easeT);
          targetZ = lerp(posGrid[i3+2], posSphere[i3+2], easeT);
        } else {
          const t = (scrollProgress - 0.6) / 0.4;
          const easeT = t * t * (3.0 - 2.0 * t);
          targetX = lerp(posSphere[i3], posCube[i3], easeT);
          targetY = lerp(posSphere[i3+1], posCube[i3+1], easeT);
          targetZ = lerp(posSphere[i3+2], posCube[i3+2], easeT);
        }

        // Apply smooth transition to target
        positions[i3] += (targetX - positions[i3]) * 0.1;
        positions[i3 + 1] += (targetY - positions[i3 + 1]) * 0.1;
        positions[i3 + 2] += (targetZ - positions[i3 + 2]) * 0.1;
      }
      
      geometry.attributes.position.needsUpdate = true;
      
      // Interpolate Color: Neon Blue -> Gold (as it hits perfect cube)
      const colorBlue = new THREE.Color(0x3b82f6);
      const colorGold = new THREE.Color(0xfbbf24);
      const finalColor = colorBlue.clone().lerp(colorGold, scrollProgress > 0.8 ? (scrollProgress - 0.8) / 0.2 : 0);
      material.uniforms.color.value = finalColor;

      renderer.render(scene, camera);
      animId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 pointer-events-none z-0 bg-black">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* Subtle radial vignette overlay to blend edges into the pitch black */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#000000_100%)] pointer-events-none" />
    </div>
  );
}
