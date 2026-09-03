"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ArrowRight, ChevronDown } from "lucide-react";

interface HeroSectionProps {
  isReady: boolean;
}

const PHRASES = [
  {
    text: "Reconciling",
    subtext: "Probabilistic Fellegi-Sunter scoring + LLM adjudication over noisy synthetic bank transaction narrations",
    images: ["/editorial/hero_bahi.jpg", "/editorial/hero_rupee.jpg"],
  },
  {
    text: "the Rupee",
    subtext: "Modeling asymmetric TDS §194C/J deductions, GST net invoices, and UTR clearing",
    images: ["/editorial/hero_rupee.jpg", "/editorial/hero_vault.jpg"],
  },
  {
    text: "Ledger to Ledger",
    subtext: "Kuhn-Munkres O(n³) Hungarian assignment resolving greedy allocation collisions",
    images: ["/editorial/hero_desk.jpg", "/editorial/hero_bahi.jpg"],
  },
  {
    text: "AI-Adjudicated",
    subtext: "Gemini 2.5 Flash-Lite → Groq Llama 3.3 70B failover explains every ambiguous match in plain English with a bounded ±20 confidence delta",
    images: ["/editorial/hero_settlement.jpg", "/editorial/hero_bahi.jpg"],
  },
  {
    text: "Explained",
    subtext: "Verifiable confidence scores across 60–80 synthetic records — AI enhances explanation, deterministic code enforces the final decision",
    images: ["/editorial/hero_settlement.jpg", "/editorial/hero_vault.jpg"],
  },
];

export default function HeroSection({ isReady }: HeroSectionProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cycleTlRef = useRef<gsap.core.Timeline | null>(null);

  // Handle scroll detection to fade out scroll indicator
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 40) {
        setScrolled(true);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Staggered Entrance Reveal and Word Cycling Timeline
  useEffect(() => {
    if (!isReady) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      if (prefersReducedMotion) {
        gsap.set(".hero-entrance-item", { opacity: 1, y: 0 });
        return;
      }

      // ── STEP 1: INITIAL STATE FOR ENTRANCE ──
      gsap.set(".hero-entrance-badge", { opacity: 0, y: -16 });
      gsap.set(".hero-entrance-title", { opacity: 0, y: 36 });
      gsap.set(".hero-entrance-subhead", { opacity: 0, y: 24 });
      gsap.set(".hero-entrance-cta", { opacity: 0, y: 20 });
      gsap.set(".hero-entrance-footer", { opacity: 0 });
      gsap.set(".hero-bg-wrapper", { opacity: 0 });

      // ── STEP 2: ENTRANCE TIMELINE (Plays right after preloader fades) ──
      const entranceTl = gsap.timeline({
        onComplete: () => {
          // ── STEP 3: START WORD-CYCLING LOOP AFTER ENTRANCE COMPLETES ──
          startCycleTimeline();
        },
      });

      // Reveal background subtly
      entranceTl.to(".hero-bg-wrapper", {
        opacity: 1,
        duration: 1.2,
        ease: "power2.out",
      });

      // Reveal top badge
      entranceTl.to(
        ".hero-entrance-badge",
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          ease: "power2.out",
        },
        "-=0.9"
      );

      // Reveal massive headline
      entranceTl.to(
        ".hero-entrance-title",
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power3.out",
        },
        "-=0.4"
      );

      // Reveal subhead
      entranceTl.to(
        ".hero-entrance-subhead",
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: "power2.out",
        },
        "-=0.4"
      );

      // Reveal CTAs
      entranceTl.to(
        ".hero-entrance-cta",
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.1,
          ease: "power2.out",
        },
        "-=0.3"
      );

      // Reveal bottom scroll indicator
      entranceTl.to(
        ".hero-entrance-footer",
        {
          opacity: 1,
          duration: 0.5,
          ease: "power2.out",
        },
        "-=0.2"
      );

      function startCycleTimeline() {
        const tl = gsap.timeline({ repeat: -1 });
        cycleTlRef.current = tl;

        // Per-phrase hold durations — index 0 ("Reconciling") holds briefly before flipping to "the Rupee"
        const HOLD_DURATIONS = [0.9, 2.2, 2.2, 2.2];

        PHRASES.forEach((_, index) => {
          const nextIndex = (index + 1) % PHRASES.length;

          tl.to(
            {},
            {
              duration: HOLD_DURATIONS[index],
              onStart: () => {
                setActiveIdx(index);
              },
            }
          );

          // Crossfade out current phrase & background
          tl.to(`.hero-phrase-${index}`, {
            opacity: 0,
            y: -20,
            filter: "blur(6px)",
            duration: 0.55,
            ease: "power2.in",
          });

          tl.to(
            `.hero-bg-pair-${index}`,
            {
              opacity: 0,
              duration: 0.75,
              ease: "power2.inOut",
            },
            "<"
          );

          // Crossfade in next phrase & background
          tl.fromTo(
            `.hero-phrase-${nextIndex}`,
            { opacity: 0, y: 24, filter: "blur(6px)" },
            {
              opacity: 1,
              y: 0,
              filter: "blur(0px)",
              duration: 0.65,
              ease: "power2.out",
              onStart: () => {
                setActiveIdx(nextIndex);
              },
            },
            "-=0.15"
          );

          tl.to(
            `.hero-bg-pair-${nextIndex}`,
            {
              opacity: 1,
              duration: 0.75,
              ease: "power2.inOut",
            },
            "<"
          );
        });
      }
    }, containerRef);

    return () => {
      ctx.revert();
    };
  }, [isReady]);

  return (
    <section
      ref={containerRef}
      className="relative w-full min-h-[100vh] flex flex-col justify-between pt-28 pb-12 px-6 md:px-12 overflow-hidden bg-[#15120E] text-[#EDE6D6] select-none"
    >
      {/* ── 1. SEAMLESS BACKGROUND BLEND (Solid underlay + feathered mask + edge fades) ── */}
      <div className="hero-bg-wrapper absolute inset-0 z-0 overflow-hidden pointer-events-none bg-[#15120E]">
        
        {/* Underlay Ambient Glow (Forest & Camel at subtle 6-8% opacity) */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,rgba(46,74,56,0.12),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_35%_at_48%_42%,rgba(180,135,90,0.08),transparent_65%)]" />

        {/* Stacked Background Image Pairs with Radial Feather Mask */}
        <div className="absolute inset-0 w-full h-full hero-seamless-mask">
          {PHRASES.map((phrase, pIdx) => (
            <div
              key={pIdx}
              className={`hero-bg-pair-${pIdx} absolute inset-0 transition-opacity duration-700 ${
                pIdx === activeIdx ? "opacity-100" : "opacity-0"
              }`}
            >
              {/* Primary Layer: Low exposure, desaturated to blend natively with #15120E */}
              <div className="absolute inset-0 w-full h-full">
                <Image
                  src={phrase.images[0]}
                  alt="Editorial financial texture primary"
                  fill
                  priority={pIdx === 0}
                  className="object-cover object-center filter brightness-[0.32] contrast-[0.88] saturate-[0.68]"
                />
              </div>

              {/* Secondary Texture: Subtle blended depth */}
              <div className="absolute inset-0 w-full h-full opacity-25 mix-blend-screen">
                <Image
                  src={phrase.images[1]}
                  alt="Editorial financial texture secondary"
                  fill
                  priority={pIdx === 0}
                  className="object-cover object-center filter brightness-[0.40] contrast-[0.90] saturate-[0.70]"
                />
              </div>
            </div>
          ))}
        </div>

        {/* 4-Directional Linear Fades to Guarantee Zero Rectangular Boundary */}
        <div className="absolute top-0 left-0 right-0 h-40 hero-edge-fade-top z-10 pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-48 hero-edge-fade-bottom z-10 pointer-events-none" />
        <div className="absolute inset-0 hero-edge-fade-sides z-10 pointer-events-none" />
      </div>

      {/* ── 2. TOP BADGE (Honest Buildathon Prototype Label) ── */}
      <div className="relative z-20 max-w-[1400px] w-full mx-auto flex items-center justify-between">
        <div className="hero-entrance-badge inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-[#1D1812]/90 border border-[rgba(180,135,90,0.25)] backdrop-blur-sm shadow-[0_2px_12px_rgba(21,18,14,0.6)]">
          <span className="w-2 h-2 rounded-full bg-[#6E2B34] animate-pulse" />
          <span className="font-mono text-[11px] uppercase tracking-widest text-[#EDE6D6]">
            AI-Powered Reconciliation · Razorpay Buildathon Track 04
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-3 font-mono text-xs text-[#A69A85]">
          <span>GEMINI · GROQ · SYNTHETIC TEST BENCH</span>
        </div>
      </div>

      {/* ── 3. CENTER CYCLING HEADLINE ── */}
      <div className="relative z-20 max-w-[1400px] w-full mx-auto my-auto py-12 md:py-20">
        <div className="relative min-h-[160px] sm:min-h-[220px] md:min-h-[280px] lg:min-h-[320px] flex items-center">
          {PHRASES.map((phrase, pIdx) => (
            <div
              key={pIdx}
              className={`hero-phrase-${pIdx} absolute inset-0 flex flex-col justify-center ${
                pIdx === activeIdx ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <h1 className="hero-entrance-title font-display font-light text-5xl sm:text-7xl md:text-8xl lg:text-9xl tracking-tight text-[#EDE6D6] leading-[0.95]">
                {phrase.text}
              </h1>
              <p className="hero-entrance-subhead mt-4 sm:mt-6 font-body text-base sm:text-xl md:text-2xl font-light text-[#A69A85] max-w-2xl leading-relaxed">
                {phrase.subtext}
              </p>
            </div>
          ))}
        </div>

        {/* CTA Bar */}
        <div className="mt-10 sm:mt-14 flex flex-wrap items-center gap-5">
          <Link
            href="/batches/new"
            className="hero-entrance-cta btn-primary-forest group"
          >
            <span>Start Intake Dispatch</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>

          <Link
            href="#story"
            className="hero-entrance-cta btn-secondary-camel"
          >
            <span>Explore The Proof</span>
          </Link>
        </div>
      </div>

      {/* ── 4. BOTTOM SCROLL INDICATOR ── */}
      <div
        className={`hero-entrance-footer relative z-20 max-w-[1400px] w-full mx-auto flex items-center justify-between transition-opacity duration-500 ${
          scrolled ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        <div className="flex items-center gap-2 font-mono text-xs text-[#A69A85]">
          <span className="text-[#B4875A] font-semibold">0{activeIdx + 1}</span>
          <span>/</span>
          <span>05</span>
        </div>

        <div className="flex flex-col items-center gap-1.5 cursor-pointer text-[#EDE6D6] animate-bounce-slow">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#A69A85]">
            Scroll
          </span>
          <ChevronDown className="w-4 h-4 text-[#B4875A]" />
        </div>

        <div className="font-mono text-xs text-[#A69A85] text-right">
          AI-POWERED · BIPARTITE MATRIX
        </div>
      </div>
    </section>
  );
}
