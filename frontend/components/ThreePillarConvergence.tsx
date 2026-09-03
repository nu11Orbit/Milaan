"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const PILLARS = [
  {
    id: "rules",
    title: "Rules Engine",
    subtitle: "Deterministic Invariants",
    detail: "PAN-UTR exact pairing, statutory TDS §194C/J threshold brackets, and bank IFSC routing tables.",
    image: "/editorial/pillar_rules.jpg",
  },
  {
    id: "fuzzy",
    title: "Fuzzy + Semantic",
    subtitle: "Probabilistic Matching",
    detail: "Fellegi-Sunter log-likelihood vectors, sentence-transformer embeddings (all-MiniLM-L6-v2), phonetic fuzzy resolution — ambiguous cases escalated to LLM adjudication.",
    image: "/editorial/pillar_fuzzy.jpg",
  },
  {
    id: "combinatorics",
    title: "Combinatorics",
    subtitle: "Bipartite Optimization",
    detail: "Kuhn-Munkres O(n³) Hungarian assignment and subset-sum solvers resolving multi-invoice bulk payouts.",
    image: "/editorial/pillar_combinatorics.jpg",
  },
];

export default function ThreePillarConvergence() {
  const triggerRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const pinElement = pinRef.current;
      const triggerElement = triggerRef.current;
      if (!pinElement || !triggerElement) return;

      const leftPanel = document.querySelector(".pillar-panel-left");
      const centerPanel = document.querySelector(".pillar-panel-center");
      const rightPanel = document.querySelector(".pillar-panel-right");
      const vennEmblem = document.querySelector(".convergence-venn-emblem");

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: triggerElement,
          start: "top top",
          end: "bottom bottom",
          pin: pinElement,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });

      // Left panel moves toward center, scales down slightly
      tl.to(
        leftPanel,
        {
          xPercent: 75,
          scale: 0.88,
          opacity: 0.35,
          ease: "none",
          duration: 1.5,
        },
        0
      );

      // Right panel moves toward center, scales down slightly
      tl.to(
        rightPanel,
        {
          xPercent: -75,
          scale: 0.88,
          opacity: 0.35,
          ease: "none",
          duration: 1.5,
        },
        0
      );

      // Center panel concentrates
      tl.to(
        centerPanel,
        {
          scale: 0.95,
          opacity: 0.45,
          ease: "none",
          duration: 1.5,
        },
        0
      );

      // Venn Diagram Emblem scales and glows up into focus
      tl.fromTo(
        vennEmblem,
        { scale: 0.4, opacity: 0, filter: "blur(8px)" },
        { scale: 1, opacity: 1, filter: "blur(0px)", ease: "power2.out", duration: 1.2 },
        0.5
      );
    }, triggerRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <div
      id="pillars"
      ref={triggerRef}
      className="relative w-full h-[320vh] bg-[#15120E] text-[#EDE6D6] select-none"
    >
      {/* ── 100vh PINNED CONTAINER ── */}
      <div
        ref={pinRef}
        className="relative w-full h-screen flex flex-col justify-between p-6 sm:p-12 md:p-16 overflow-hidden"
      >
        {/* Section Identifier */}
        <div className="relative z-20 max-w-[1400px] w-full mx-auto flex items-center justify-between">
          <div className="font-mono text-xs text-[#B4875A] uppercase tracking-widest font-semibold">
            04 / THREE-PILLAR CONVERGENCE
          </div>
          <div className="font-mono text-xs text-[#A69A85] uppercase tracking-widest hidden sm:block">
            Scroll to Converge Pipeline
          </div>
        </div>

        {/* Center Convergence Stage */}
        <div className="relative z-20 max-w-[1400px] w-full mx-auto my-auto py-6">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="font-display text-3xl sm:text-5xl font-light tracking-tight text-[#EDE6D6]">
              The Core Triad
            </h2>
            <p className="font-body text-sm sm:text-base text-[#A69A85] mt-3">
              Three algorithmic pillars converge into one deterministic confidence score.
            </p>
          </div>

          {/* 3 Panels Row with Central Venn Emblem */}
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto min-h-[380px] items-center">
            
            {/* Panel 1: Left */}
            <div className="pillar-panel-left relative h-[360px] rounded-2xl overflow-hidden border border-[rgba(180,135,90,0.22)] p-6 flex flex-col justify-between bg-[#1D1812] shadow-[0_4px_20px_rgba(21,18,14,0.6)]">
              <Image
                src={PILLARS[0].image}
                alt={PILLARS[0].title}
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover object-center opacity-30 filter brightness-75"
              />
              <div className="relative z-10 font-mono text-xs uppercase tracking-widest text-[#B4875A]">
                PILLAR 01
              </div>
              <div className="relative z-10 space-y-2">
                <h3 className="font-display font-medium text-2xl text-[#EDE6D6]">
                  {PILLARS[0].title}
                </h3>
                <div className="font-mono text-xs text-[#B4875A]">
                  {PILLARS[0].subtitle}
                </div>
                <p className="font-body text-xs text-[#A69A85] leading-relaxed">
                  {PILLARS[0].detail}
                </p>
              </div>
            </div>

            {/* Panel 2: Center */}
            <div className="pillar-panel-center relative h-[360px] rounded-2xl overflow-hidden border border-[rgba(180,135,90,0.22)] p-6 flex flex-col justify-between bg-[#1D1812] shadow-[0_4px_20px_rgba(21,18,14,0.6)]">
              <Image
                src={PILLARS[1].image}
                alt={PILLARS[1].title}
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover object-center opacity-30 filter brightness-75"
              />
              <div className="relative z-10 font-mono text-xs uppercase tracking-widest text-[#B4875A]">
                PILLAR 02
              </div>
              <div className="relative z-10 space-y-2">
                <h3 className="font-display font-medium text-2xl text-[#EDE6D6]">
                  {PILLARS[1].title}
                </h3>
                <div className="font-mono text-xs text-[#B4875A]">
                  {PILLARS[1].subtitle}
                </div>
                <p className="font-body text-xs text-[#A69A85] leading-relaxed">
                  {PILLARS[1].detail}
                </p>
              </div>
            </div>

            {/* Panel 3: Right */}
            <div className="pillar-panel-right relative h-[360px] rounded-2xl overflow-hidden border border-[rgba(180,135,90,0.22)] p-6 flex flex-col justify-between bg-[#1D1812] shadow-[0_4px_20px_rgba(21,18,14,0.6)]">
              <Image
                src={PILLARS[2].image}
                alt={PILLARS[2].title}
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover object-center opacity-30 filter brightness-75"
              />
              <div className="relative z-10 font-mono text-xs uppercase tracking-widest text-[#B4875A]">
                PILLAR 03
              </div>
              <div className="relative z-10 space-y-2">
                <h3 className="font-display font-medium text-2xl text-[#EDE6D6]">
                  {PILLARS[2].title}
                </h3>
                <div className="font-mono text-xs text-[#B4875A]">
                  {PILLARS[2].subtitle}
                </div>
                <p className="font-body text-xs text-[#A69A85] leading-relaxed">
                  {PILLARS[2].detail}
                </p>
              </div>
            </div>

            {/* Central Venn Diagram SVG Emblem */}
            <div className="convergence-venn-emblem absolute inset-0 flex items-center justify-center pointer-events-none z-30 opacity-0">
              <div className="p-8 rounded-full bg-[#15120E]/95 border border-[rgba(180,135,90,0.4)] shadow-[0_0_50px_rgba(46,74,56,0.45)] backdrop-blur-md flex flex-col items-center justify-center text-center">
                <svg
                  width="140"
                  height="120"
                  viewBox="0 0 140 120"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="mb-2"
                >
                  <circle
                    cx="52"
                    cy="48"
                    r="34"
                    stroke="#2E4A38"
                    strokeWidth="2"
                    strokeDasharray="3 3"
                    className="opacity-90"
                  />
                  <circle
                    cx="88"
                    cy="48"
                    r="34"
                    stroke="#B4875A"
                    strokeWidth="2"
                    strokeDasharray="3 3"
                    className="opacity-90"
                  />
                  <circle
                    cx="70"
                    cy="76"
                    r="34"
                    stroke="#EDE6D6"
                    strokeWidth="2"
                    strokeDasharray="3 3"
                    className="opacity-80"
                  />
                  {/* Central Intersection Core */}
                  <circle cx="70" cy="58" r="10" fill="#2E4A38" />
                  <circle cx="70" cy="58" r="4" fill="#B4875A" />
                </svg>
                <div className="font-mono text-xs font-bold text-[#EDE6D6] uppercase tracking-widest">
                  100% RECONCILED
                </div>
                <div className="font-mono text-[10px] text-[#B4875A] mt-0.5">
                  LLM-Explained · Bounded Confidence
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Bottom Subtitle */}
        <div className="relative z-20 max-w-[1400px] w-full mx-auto flex items-center justify-between font-mono text-[11px] text-[#A69A85]">
          <span>KUHN-MUNKRES MATCHING ENGINE</span>
          <span>ZERO COLLISION PROBABILITY</span>
        </div>
      </div>
    </div>
  );
}
