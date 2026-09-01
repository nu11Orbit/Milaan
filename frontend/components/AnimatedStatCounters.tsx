"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

interface CounterItem {
  id: string;
  targetValue: number;
  decimals: number;
  prefix?: string;
  suffix?: string;
  isPending?: boolean;
  label: string;
  sublabel: string;
}

const STATS: CounterItem[] = [
  {
    id: "batch-size",
    targetValue: 80,
    decimals: 0,
    prefix: "",
    suffix: " Records",
    label: "Evaluation Batch",
    sublabel: "Simulated Indian RTGS, NEFT, and IMPS synthetic records",
  },
  {
    id: "latency",
    targetValue: 0.38,
    decimals: 2,
    suffix: "ms",
    label: "Solve Latency",
    sublabel: "Per Kuhn-Munkres O(n³) Hungarian bipartite matrix step",
  },
  {
    id: "passes",
    targetValue: 3,
    decimals: 0,
    suffix: " Passes",
    label: "Algorithmic Pipeline",
    sublabel: "Deterministic rules, Fellegi-Sunter scoring, Hungarian solver",
  },
  {
    id: "pending",
    targetValue: 0,
    decimals: 0,
    isPending: true,
    label: "Production Benchmark",
    sublabel: "Formal live enterprise dataset evaluation pending post-buildathon",
  },
];

export default function AnimatedStatCounters() {
  const [hasAnimated, setHasAnimated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayValues, setDisplayValues] = useState<{ [key: string]: string }>({
    "batch-size": "0",
    latency: "0.00",
    passes: "0",
    pending: "—",
  });

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);

          STATS.forEach((stat) => {
            if (stat.isPending) return;

            const proxy = { val: 0 };
            gsap.to(proxy, {
              val: stat.targetValue,
              duration: 2.0,
              ease: "power3.out",
              onUpdate: () => {
                setDisplayValues((prev) => ({
                  ...prev,
                  [stat.id]: proxy.val.toFixed(stat.decimals),
                }));
              },
            });
          });
        }
      },
      { threshold: 0.25 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [hasAnimated]);

  return (
    <section
      id="metrics"
      ref={containerRef}
      className="w-full bg-[#15120E] py-24 sm:py-32 border-y border-[rgba(237,230,214,0.08)] text-[#EDE6D6] select-none"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-16 pb-8 border-b border-[rgba(237,230,214,0.08)]">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-[#B4875A] mb-3">
              05 / MATHEMATICAL BENCHMARKS
            </div>
            <h2 className="font-display text-4xl sm:text-5xl md:text-6xl font-light tracking-tight text-[#EDE6D6]">
              Evaluation Metrics
            </h2>
          </div>
          <div className="font-mono text-xs text-[#A69A85] uppercase tracking-wider">
            SYNTHETIC TEST BENCH
          </div>
        </div>

        {/* 4 Counter Columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {STATS.map((stat, i) => (
            <div
              key={stat.id}
              className={`p-6 flex flex-col justify-between rounded-xl bg-[#1D1812] border border-[rgba(237,230,214,0.08)] hover:border-[rgba(180,135,90,0.3)] transition-all space-y-6 shadow-[0_4px_20px_rgba(21,18,14,0.5)] ${
                i < STATS.length - 1 ? "lg:border-r border-[rgba(237,230,214,0.08)]" : ""
              }`}
            >
              <div className="font-mono text-xs text-[#A69A85] uppercase tracking-widest">
                METRIC 0{i + 1}
              </div>

              {/* Big Monospace Numeral Display with tabular-nums */}
              <div className="my-auto py-2">
                <div className="font-mono text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#EDE6D6] tabular-nums">
                  {stat.isPending ? (
                    <span className="text-[#A69A85] font-light">—</span>
                  ) : (
                    <>
                      {stat.prefix}
                      {displayValues[stat.id] || "0"}
                      {stat.suffix && (
                        <span className="text-2xl sm:text-3xl text-[#B4875A] ml-1">
                          {stat.suffix}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="font-display font-medium text-lg text-[#EDE6D6] mt-3">
                  {stat.label}
                </div>
              </div>

              <div className="font-mono text-xs text-[#A69A85] leading-relaxed border-t border-[rgba(237,230,214,0.08)] pt-4">
                {stat.sublabel}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
