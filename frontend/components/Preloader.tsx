"use client";

import { useEffect, useState, useRef } from "react";
import gsap from "gsap";

interface PreloaderProps {
  onComplete: () => void;
  images: string[];
}

export default function Preloader({ onComplete, images }: PreloaderProps) {
  const [displayProgress, setDisplayProgress] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const progressObj = useRef({ value: 0 });

  useEffect(() => {
    let isCancelled = false;
    const MIN_LOAD_DURATION_MS = 1400; // Enforce minimum 1.4s so counter is always visibly cinematic

    // 1. Minimum delay promise
    const timerPromise = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), MIN_LOAD_DURATION_MS);
    });

    // 2. Real image preload promise
    const imagePreloadPromise = new Promise<void>((resolve) => {
      if (images.length === 0) {
        resolve();
        return;
      }
      let loaded = 0;
      const total = images.length;

      images.forEach((src) => {
        const img = new Image();
        img.onload = () => {
          loaded++;
          if (loaded >= total) resolve();
        };
        img.onerror = () => {
          loaded++;
          if (loaded >= total) resolve();
        };
        img.src = src;
      });

      // Safety timeout in case of hung network requests
      setTimeout(() => resolve(), 3500);
    });

    // Animate the counter smoothly from 0 to 95 over the minimum duration
    gsap.to(progressObj.current, {
      value: 95,
      duration: MIN_LOAD_DURATION_MS / 1000,
      ease: "power1.inOut",
      onUpdate: () => {
        if (!isCancelled) {
          setDisplayProgress(Math.round(progressObj.current.value));
        }
      },
    });

    // When both image preload and minimum timer complete:
    Promise.all([imagePreloadPromise, timerPromise]).then(() => {
      if (isCancelled) return;

      // Finish to 100%
      gsap.to(progressObj.current, {
        value: 100,
        duration: 0.25,
        ease: "power2.out",
        onUpdate: () => {
          if (!isCancelled) {
            setDisplayProgress(Math.round(progressObj.current.value));
          }
        },
        onComplete: () => {
          // Pause slightly on 100% before smooth fadeout
          setTimeout(() => {
            if (isCancelled) return;
            gsap.to("#site-preloader", {
              opacity: 0,
              duration: 0.45,
              ease: "power2.inOut",
              onComplete: () => {
                setIsDone(true);
                onComplete();
              },
            });
          }, 180);
        },
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [images, onComplete]);

  if (isDone) return null;

  return (
    <div
      id="site-preloader"
      className="fixed inset-0 z-[9999] flex flex-col justify-between p-8 md:p-14 bg-[#15120E] text-[#EDE6D6] select-none"
    >
      {/* Top Header in Loader */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-display font-medium text-xl tracking-tight text-[#EDE6D6]">
            Milaan
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#6E2B34] animate-pulse" />
        </div>
        <div className="font-mono text-xs text-[#A69A85] tracking-widest uppercase">
          Autonomous Bipartite Solver · Buildathon
        </div>
      </div>

      {/* Center Counter */}
      <div className="my-auto text-center space-y-4">
        <div className="font-mono text-6xl md:text-8xl lg:text-9xl font-bold tracking-tighter text-[#B4875A] tabular-nums">
          {displayProgress.toString().padStart(3, "0")}
          <span className="text-3xl md:text-5xl font-light text-[#A69A85] ml-2">%</span>
        </div>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-[#EDE6D6]">
          Caching Graph Nodes &amp; Synthetic Batch Feeds
        </div>
      </div>

      {/* Bottom Progress Bar & Details */}
      <div className="space-y-3">
        <div className="w-full h-[2px] bg-[#251E16] overflow-hidden rounded-full">
          <div
            className="h-full bg-gradient-to-r from-[#2E4A38] to-[#B4875A] transition-all duration-100 ease-out rounded-full"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
        <div className="flex items-center justify-between font-mono text-[11px] text-[#A69A85]">
          <span>INIT PROTOCOL: FELLEGI-SUNTER &amp; KUHN-MUNKRES</span>
          <span>SYNTHETIC 60–80 RECORD BATCH</span>
        </div>
      </div>
    </div>
  );
}
