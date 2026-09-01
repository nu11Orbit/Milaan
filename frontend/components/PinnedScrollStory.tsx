"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export default function PinnedScrollStory() {
  const triggerRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

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

      const words = gsap.utils.toArray<HTMLElement>(".story-word");
      const bgImages = gsap.utils.toArray<HTMLElement>(".story-bg-layer");

      // Initial state: hide words except first, hide backgrounds 2 & 3
      gsap.set(words, { opacity: 0.15, y: 8 });
      gsap.set(bgImages[0], { opacity: 0.85 });
      gsap.set(bgImages.slice(1), { opacity: 0 });

      // Create Scrubbed Master Timeline
      const scrubTl = gsap.timeline({
        scrollTrigger: {
          trigger: triggerElement,
          start: "top top",
          end: "bottom bottom",
          pin: pinElement,
          scrub: 0.6,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            if (progressRef.current) {
              progressRef.current.style.width = `${Math.round(self.progress * 100)}%`;
            }
          },
        },
      });

      // Progressive word illumination
      scrubTl.to(words, {
        opacity: 1,
        y: 0,
        color: "#EDE6D6",
        stagger: {
          each: 0.08,
          from: "start",
        },
        duration: 2,
        ease: "none",
      });

      // Crossfade Background 1 -> Background 2 around 35% scroll
      scrubTl.to(
        bgImages[0],
        { opacity: 0, duration: 0.8, ease: "power1.inOut" },
        0.6
      );
      scrubTl.to(
        bgImages[1],
        { opacity: 0.85, duration: 0.8, ease: "power1.inOut" },
        0.6
      );

      // Crossfade Background 2 -> Background 3 around 70% scroll
      scrubTl.to(
        bgImages[1],
        { opacity: 0, duration: 0.8, ease: "power1.inOut" },
        1.3
      );
      scrubTl.to(
        bgImages[2],
        { opacity: 0.85, duration: 0.8, ease: "power1.inOut" },
        1.3
      );
    }, triggerRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <div
      id="story"
      ref={triggerRef}
      className="relative w-full h-[350vh] bg-[#15120E] text-[#EDE6D6] select-none"
    >
      {/* ── 100vh PINNED CONTAINER ── */}
      <div
        ref={pinRef}
        className="relative w-full h-screen flex flex-col justify-between p-6 sm:p-12 md:p-20 overflow-hidden"
      >
        {/* Background Layers for Scroll-Synced Crossfade */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          {/* BG 1: Bahi Khata Munim Desk */}
          <div className="story-bg-layer absolute inset-0 w-full h-full">
            <Image
              src="/editorial/hero_desk.jpg"
              alt="Accountant bahi-khata ledger desk"
              fill
              className="object-cover object-center filter brightness-[0.35] contrast-[1.1] saturate-[0.75]"
            />
          </div>

          {/* BG 2: Digital Settlement Routing */}
          <div className="story-bg-layer absolute inset-0 w-full h-full">
            <Image
              src="/editorial/hero_settlement.jpg"
              alt="Digital transaction routing flow"
              fill
              className="object-cover object-center filter brightness-[0.38] contrast-[1.15]"
            />
          </div>

          {/* BG 3: Balanced Ledger */}
          <div className="story-bg-layer absolute inset-0 w-full h-full">
            <Image
              src="/editorial/hero_bahi.jpg"
              alt="Balanced reconciliation archival ledger"
              fill
              className="object-cover object-center filter brightness-[0.4] contrast-[1.05]"
            />
          </div>

          {/* Deep Dark Overlay & Vignette */}
          <div className="absolute inset-0 bg-[#15120E]/75 z-10" />
          <div className="absolute inset-0 bg-dark-vignette z-10" />
        </div>

        {/* Top Story Header */}
        <div className="relative z-20 max-w-[1200px] w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-[#B4875A] uppercase tracking-widest font-semibold">
              02 / THE RECONCILIATION PROBLEM
            </span>
          </div>
          <div className="font-mono text-xs text-[#A69A85] uppercase tracking-widest hidden sm:block">
            Scroll to Advance Narrative
          </div>
        </div>

        {/* Center Progressive Text Build */}
        <div className="relative z-20 max-w-[1200px] w-full mx-auto my-auto py-8">
          <div className="space-y-6 sm:space-y-10">
            
            {/* Primary Statement */}
            <h2 className="font-display text-3xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight font-light">
              <span className="story-word inline-block mr-3 text-[#EDE6D6] font-normal">Reconciliation</span>
              <span className="story-word inline-block mr-3 text-[#EDE6D6] font-normal">breaks</span>
              <span className="story-word inline-block mr-3">the</span>
              <span className="story-word inline-block mr-3">moment</span>
              <span className="story-word inline-block mr-3 text-[#B4875A] italic">real</span>
              <span className="story-word inline-block mr-3 text-[#B4875A] italic">money</span>
              <span className="story-word inline-block mr-3">moves.</span>
            </h2>

            {/* Problem Paragraph with Word-by-Word Scrub */}
            <p className="font-body text-lg sm:text-2xl md:text-3xl font-light text-[#A69A85] leading-relaxed max-w-4xl">
              <span className="story-word inline-block mr-2">Truncated</span>
              <span className="story-word inline-block mr-2">RTGS</span>
              <span className="story-word inline-block mr-2">narrations.</span>
              <span className="story-word inline-block mr-2">Asymmetric</span>
              <span className="story-word inline-block mr-2">TDS</span>
              <span className="story-word inline-block mr-2">deductions</span>
              <span className="story-word inline-block mr-2">under</span>
              <span className="story-word inline-block mr-2 text-[#B4875A]">§194C</span>
              <span className="story-word inline-block mr-2 text-[#B4875A]">&amp;</span>
              <span className="story-word inline-block mr-2 text-[#B4875A]">§194J.</span>
              <span className="story-word inline-block mr-2">Missing</span>
              <span className="story-word inline-block mr-2">invoice</span>
              <span className="story-word inline-block mr-2">numbers</span>
              <span className="story-word inline-block mr-2">across</span>
              <span className="story-word inline-block mr-2">split</span>
              <span className="story-word inline-block mr-2">batch</span>
              <span className="story-word inline-block mr-2">settlements.</span>
            </p>

            {/* Solution Punchline */}
            <div className="pt-4 sm:pt-6 border-t border-[rgba(180,135,90,0.25)] max-w-3xl">
              <p className="font-mono text-sm sm:text-base md:text-lg text-[#EDE6D6] uppercase tracking-wide">
                <span className="story-word inline-block mr-2 text-[#B4875A] font-bold">Milaan</span>
                <span className="story-word inline-block mr-2">eliminates</span>
                <span className="story-word inline-block mr-2">greedy</span>
                <span className="story-word inline-block mr-2">collisions</span>
                <span className="story-word inline-block mr-2">with</span>
                <span className="story-word inline-block mr-2 text-[#2E4A38] bg-[#EDE6D6] px-2 py-0.5 rounded font-bold">provable</span>
                <span className="story-word inline-block mr-2 text-[#B4875A]">Hungarian</span>
                <span className="story-word inline-block mr-2 text-[#B4875A]">optimization.</span>
              </p>
            </div>

          </div>
        </div>

        {/* Bottom Scroll Progress Bar */}
        <div className="relative z-20 max-w-[1200px] w-full mx-auto space-y-2">
          <div className="w-full h-[2px] bg-[#251E16] rounded-full overflow-hidden">
            <div
              ref={progressRef}
              className="h-full bg-gradient-to-r from-[#2E4A38] to-[#B4875A] w-0 transition-all duration-75 ease-linear rounded-full"
            />
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] text-[#A69A85] uppercase tracking-widest">
            <span>SCROLL PROGRESSION</span>
            <span>PROVABLE RESOLUTION</span>
          </div>
        </div>

      </div>
    </div>
  );
}
