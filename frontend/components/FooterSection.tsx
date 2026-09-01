"use client";

import Link from "next/link";
import { ArrowUp, ArrowRight } from "lucide-react";

export default function FooterSection() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer className="w-full bg-[#15120E] text-[#EDE6D6] border-t border-[rgba(237,230,214,0.08)] select-none">
      
      {/* ── BRIDGING TRANSITION MARQUEE ── */}
      <div className="w-full py-12 bg-[#1D1812] border-b border-[rgba(237,230,214,0.08)] overflow-hidden marquee-container">
        <div className="flex w-max items-center gap-12 whitespace-nowrap animate-marquee-left-slow">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-12">
              <span className="font-display italic text-3xl sm:text-4xl text-[#A69A85] line-through decoration-[#B4875A] decoration-2">
                Manual Spreadsheet Guesswork
              </span>
              <span className="font-mono text-xs text-[#B4875A]">→</span>
              <span className="font-display font-medium text-3xl sm:text-4xl text-[#EDE6D6]">
                Autonomous Bipartite Solver
              </span>
              <span className="w-2 h-2 rounded-full bg-[#2E4A38]" />
              <span className="font-mono text-xs uppercase tracking-widest text-[#A69A85]">
                O(n³) Kuhn-Munkres Polish
              </span>
              <span className="w-2 h-2 rounded-full bg-[#B4875A]" />
            </div>
          ))}
        </div>
      </div>

      {/* ── MAIN FOOTER CONTENT ── */}
      <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-20">
        
        {/* Top Row: Mission Statement & Dispatch Callout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 pb-16 border-b border-[rgba(237,230,214,0.08)] items-start">
          
          <div className="lg:col-span-7 space-y-6">
            <div className="flex items-center gap-3">
              <span className="font-display font-medium text-3xl tracking-tight text-[#EDE6D6]">
                Milaan
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-[#6E2B34]" />
            </div>
            <p className="font-body text-lg sm:text-xl font-light text-[#A69A85] max-w-xl leading-relaxed">
              An autonomous financial reconciliation prototype exploring probabilistic Fellegi-Sunter scoring, Kuhn-Munkres Hungarian bipartite matching, and Benford&apos;s Law anomaly detection across synthetic Indian financial datasets.
            </p>
            <div className="font-mono text-xs text-[#A69A85] uppercase tracking-widest">
              SECTION 194C · SECTION 194J · GST RULE 36(4) · SYNTHETIC EVALUATION
            </div>
          </div>

          {/* Quick CTA Box */}
          <div className="lg:col-span-5 p-8 rounded-2xl bg-[#1D1812] border border-[rgba(180,135,90,0.22)] space-y-6 shadow-[0_4px_24px_rgba(21,18,14,0.6)]">
            <div className="font-mono text-xs uppercase tracking-widest text-[#B4875A]">
              Run Evaluation Batch
            </div>
            <h3 className="font-display text-2xl font-light text-[#EDE6D6]">
              Dispatch a synthetic test batch in seconds.
            </h3>
            <Link
              href="/batches/new"
              className="btn-primary-forest w-full justify-between"
            >
              <span>Deploy Intake Dispatch</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

        </div>

        {/* Middle Row: Links Columns */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-10 py-16 border-b border-[rgba(237,230,214,0.08)]">
          
          <div className="space-y-4">
            <div className="font-mono text-xs uppercase tracking-widest text-[#B4875A]">
              Core Engine
            </div>
            <ul className="space-y-2.5 font-mono text-xs text-[#A69A85]">
              <li><Link href="#story" className="hover:text-[#EDE6D6] transition-colors">Problem Paradigm</Link></li>
              <li><Link href="#pipeline" className="hover:text-[#EDE6D6] transition-colors">Five-Pass Pipeline</Link></li>
              <li><Link href="#pillars" className="hover:text-[#EDE6D6] transition-colors">Algorithmic Triad</Link></li>
              <li><Link href="#metrics" className="hover:text-[#EDE6D6] transition-colors">Synthetic Metrics</Link></li>
            </ul>
          </div>

          <div className="space-y-4">
            <div className="font-mono text-xs uppercase tracking-widest text-[#B4875A]">
              Tax Logic Modeled
            </div>
            <ul className="space-y-2.5 font-mono text-xs text-[#A69A85]">
              <li><span>TDS §194C (1% / 2%)</span></li>
              <li><span>TDS §194J (10%)</span></li>
              <li><span>GST Rule 36(4) Matching</span></li>
              <li><span>Net vs Gross Analysis</span></li>
            </ul>
          </div>

          <div className="space-y-4">
            <div className="font-mono text-xs uppercase tracking-widest text-[#B4875A]">
              Stack &amp; Algorithms
            </div>
            <ul className="space-y-2.5 font-mono text-xs text-[#A69A85]">
              <li><span>Kuhn-Munkres O(n³)</span></li>
              <li><span>Fellegi-Sunter EM</span></li>
              <li><span>Benford Chi-Square</span></li>
              <li><span>Next.js + FastAP</span></li>
            </ul>
          </div>

          <div className="space-y-4">
            <div className="font-mono text-xs uppercase tracking-widest text-[#B4875A]">
              Buildathon Project
            </div>
            <ul className="space-y-2.5 font-mono text-xs text-[#A69A85]">
              <li><Link href="/batches/new" className="hover:text-[#EDE6D6] transition-colors">New Batch Upload</Link></li>
              <li><span>Synthetic 60–80 Records</span></li>
              <li><span>Evaluation Harness</span></li>
            </ul>
          </div>

        </div>

        {/* Bottom Row: Copyright & Back-to-Top */}
        <div className="pt-10 flex flex-col sm:flex-row items-center justify-between gap-6 font-mono text-xs text-[#A69A85]">
          <div>
            © {new Date().getFullYear()} MILAAN RECONCILIATION · BUILDATHON PROTOTYPE
          </div>

          <button
            onClick={scrollToTop}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1D1812] border border-[rgba(180,135,90,0.25)] text-[#EDE6D6] hover:text-[#B4875A] hover:border-[#B4875A] transition-all hover:scale-105"
            aria-label="Back to top"
          >
            <span>Back to Top</span>
            <ArrowUp className="w-3.5 h-3.5 text-[#2E4A38]" />
          </button>
        </div>

      </div>
    </footer>
  );
}
