"use client";

import { useEffect, useRef, useState } from "react";

const RESULTS = [
  {
    num: "01",
    metric: "60–80",
    title: "Synthetic Test Records",
    description: "Evaluated on simulated Indian bank feeds and ERP rows containing intentional noise, truncated RTGS narrations, and split payments.",
    tag: "Evaluation Batch Size",
    signalColor: "#3C6B4C",
  },
  {
    num: "02",
    metric: "0.38ms",
    title: "Hungarian Solve Time",
    description: "Calculates minimal-cost bipartite optimal assignment matrix to eliminate greedy allocation collisions across concurrent rows.",
    tag: "O(n³) Bipartite Latency",
    signalColor: "#3C6B4C",
  },
  {
    num: "03",
    metric: "—",
    title: "Pending Evaluation Run",
    description: "Formal benchmark against live production enterprise datasets will be conducted post-buildathon evaluation.",
    tag: "Production Benchmark",
    signalColor: "#B4875A",
  },
];

export default function NumberedResultsGrid() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.15 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="w-full max-w-[1400px] mx-auto px-6 md:px-12 py-24 sm:py-32 bg-[#15120E] text-[#EDE6D6]"
    >
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16 pb-8 border-b border-[rgba(237,230,214,0.08)]">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-[#B4875A] mb-3">
            03 / ALGORITHMIC EVALUATION BENCHMARKS
          </div>
          <h2 className="font-display text-4xl sm:text-5xl md:text-6xl font-light tracking-tight text-[#EDE6D6]">
            Synthetic Batch Performance
          </h2>
        </div>
        <p className="font-body text-base text-[#A69A85] max-w-md">
          Evaluated on synthetic test batches modeled after Indian banking narrations and statutory TDS deduction structures.
        </p>
      </div>

      {/* 3 Numbered Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {RESULTS.map((res, i) => (
          <div
            key={res.num}
            style={{
              transitionDelay: `${i * 120}ms`,
            }}
            className={`p-8 rounded-2xl bg-[#1D1812] border border-[rgba(237,230,214,0.08)] hover:border-[rgba(180,135,90,0.4)] transition-all duration-700 transform flex flex-col justify-between shadow-[0_4px_24px_rgba(21,18,14,0.5)] ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
            }`}
          >
            {/* Top Row: Number & Tag */}
            <div>
              <div className="flex items-center justify-between pb-6 border-b border-[rgba(237,230,214,0.08)]">
                <span className="font-mono text-xl font-bold text-[#B4875A] tabular-nums">
                  {res.num}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-[#A69A85] px-3 py-1 rounded-full bg-[#15120E] border border-[rgba(180,135,90,0.18)]">
                  {res.tag}
                </span>
              </div>

              {/* Big Metric Display */}
              <div className="py-6">
                <div className="font-mono text-4xl sm:text-5xl font-bold text-[#EDE6D6] tabular-nums tracking-tight">
                  {res.metric}
                </div>
                <h3 className="font-display font-medium text-xl text-[#B4875A] mt-2">
                  {res.title}
                </h3>
              </div>
            </div>

            {/* Description */}
            <p className="font-body text-sm text-[#A69A85] leading-relaxed pt-4 border-t border-[rgba(237,230,214,0.08)]">
              {res.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
