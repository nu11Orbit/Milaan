"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BarChart2 } from "lucide-react";

interface LastRun {
  batchId: string;
  runId: string;
}

export default function Header() {
  const [lastRun, setLastRun] = useState<LastRun | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("milaan_last_run");
      if (raw) setLastRun(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#15120E]/90 backdrop-blur-md border-b border-[rgba(237,230,214,0.08)] transition-all duration-300">
      <div className="max-w-[1400px] mx-auto px-6 md:px-12 h-20 flex items-center justify-between">

        {/* Wordmark */}
        <Link href="/" className="inline-flex items-center gap-2.5 group no-underline">
          <span className="font-display font-medium text-2xl tracking-tight text-[#EDE6D6] group-hover:text-[#B4875A] transition-colors">
            Milaan
          </span>
          <span className="w-2 h-2 rounded-full bg-[#6E2B34] transition-transform group-hover:scale-125" />
          <span className="hidden sm:inline-block font-mono text-[10px] uppercase tracking-widest text-[#A69A85] ml-2 border-l border-[rgba(237,230,214,0.12)] pl-2">
            Synthetic Batch Solver
          </span>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-8 font-mono text-xs uppercase tracking-wider text-[#A69A85]">
          <Link href="/#story" className="hover:text-[#B4875A] transition-colors">Story</Link>
          <Link href="/#pipeline" className="hover:text-[#B4875A] transition-colors">Five Passes</Link>
          <Link href="/#pillars" className="hover:text-[#B4875A] transition-colors">Architecture</Link>
          <Link href="/#metrics" className="hover:text-[#B4875A] transition-colors">Evaluation</Link>
        </nav>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          {/* Last Run — only shown after at least one batch has been submitted */}
          {lastRun && (
            <Link
              href={`/batches/${lastRun.batchId}/results?runId=${lastRun.runId}`}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] uppercase tracking-wider transition-all"
              style={{
                background: "rgba(180,135,90,0.08)",
                border: "1px solid rgba(180,135,90,0.25)",
                color: "#B4875A",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(180,135,90,0.14)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,135,90,0.45)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(180,135,90,0.08)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,135,90,0.25)";
              }}
            >
              <BarChart2 className="w-3 h-3" />
              <span>Last Run</span>
              <ArrowRight className="w-3 h-3 opacity-60" />
            </Link>
          )}

          <Link href="/batches/new" className="btn-primary-forest">
            <span>Start Intake</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

      </div>
    </header>
  );
}
