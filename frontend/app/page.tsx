"use client";

import { useState, useCallback } from "react";
import Preloader from "@/components/Preloader";
import HeroSection from "@/components/HeroSection";
import PinnedScrollStory from "@/components/PinnedScrollStory";
import InfiniteMarquee from "@/components/InfiniteMarquee";
import NumberedResultsGrid from "@/components/NumberedResultsGrid";
import ThreePillarConvergence from "@/components/ThreePillarConvergence";
import AnimatedStatCounters from "@/components/AnimatedStatCounters";
import FooterSection from "@/components/FooterSection";
import AIExplainabilitySection from "@/components/AIExplainabilitySection";

const PRELOAD_ASSETS = [
  "/editorial/hero_bahi.jpg",
  "/editorial/hero_rupee.jpg",
  "/editorial/hero_desk.jpg",
  "/editorial/hero_settlement.jpg",
  "/editorial/hero_vault.jpg",
  "/editorial/pillar_rules.jpg",
  "/editorial/pillar_fuzzy.jpg",
  "/editorial/pillar_combinatorics.jpg",
];

export default function HomePage() {
  const [isPreloadComplete, setIsPreloadComplete] = useState(false);

  const handlePreloadComplete = useCallback(() => {
    setIsPreloadComplete(true);
  }, []);

  return (
    <div className="w-full flex flex-col items-center bg-[#15120E] text-[#EDE6D6] min-h-screen">
      {/* ── 01. PRELOAD SEQUENCE ── */}
      <Preloader onComplete={handlePreloadComplete} images={PRELOAD_ASSETS} />

      {/* ── 02. SECTION 1: HERO WORD-CYCLING & IMAGE CROSSFADE ── */}
      <HeroSection isReady={isPreloadComplete} />

      {/* ── 03. SECTION 2: PINNED SCROLL-STORY ── */}
      <PinnedScrollStory />

      {/* ── 04. SECTION 3: INFINITE MARQUEE (PIPELINE PASSES) ── */}
      <InfiniteMarquee />

      {/* ── 05. SECTION 4: NUMBERED RESULTS GRID ── */}
      <NumberedResultsGrid />

      {/* ── 06. SECTION 5: THREE-PILLAR CONVERGENCE ── */}
      <ThreePillarConvergence />

      {/* ── 06. SECTION 5.5: AI ADJUDICATION LAYER ── */}
      <AIExplainabilitySection />

      {/* ── 07. SECTION 6: ANIMATED STAT COUNTERS ── */}
      <AnimatedStatCounters />

      {/* ── 08. SECTION 7: CLOSING MARQUEE + FOOTER ── */}
      <FooterSection />
    </div>
  );
}
