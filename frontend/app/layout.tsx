import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Layers } from "lucide-react";
import MilaanCanvas from "@/components/MilaanCanvas";
import "./globals.css";

export const metadata: Metadata = {
  title: "Milaan — Autonomous Financial Reconciliation Engine",
  description:
    "Next-generation AI reconciliation engine for Indian enterprise finance teams. Probabilistic Fellegi-Sunter scoring, Hungarian O(n³) optimal matching, and Benford's Law forensic auditing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--ink)] antialiased selection:bg-[var(--gold)]/20 selection:text-white overflow-x-hidden">

        {/* ── Dynamic igloo-style wireframe parallax canvas ── */}
        <MilaanCanvas />

        {/* ── Navigation ── */}
        <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-2xl">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5 group">
              {/* Monogram mark */}
              <div className="w-7 h-7 rounded-md flex items-center justify-center border border-[var(--gold)]/40 group-hover:border-[var(--gold)] transition-colors"
                   style={{ background: "rgba(201,169,110,0.08)" }}>
                <span className="font-mono text-[var(--gold)] font-bold text-xs">M</span>
              </div>
              <span className="font-display font-semibold text-sm tracking-wide text-[var(--ink)] group-hover:text-[var(--mist)] transition-colors">
                Milaan
              </span>
            </Link>

            {/* Nav links */}
            <nav className="hidden md:flex items-center gap-1">
              {[
                { href: "/", label: "Overview" },
                { href: "/#algorithms", label: "Architecture" },
                { href: "/#simulator", label: "Sandbox" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-white/[0.04] transition-all"
                >
                  {label}
                </Link>
              ))}
            </nav>

            {/* Right */}
            <div className="flex items-center gap-3">
              <Link
                href="/batches/new"
                className="flex items-center gap-1.5 btn-primary py-2 px-4 text-[10px]"
              >
                <Layers className="w-3 h-3" />
                <span>New Batch</span>
                <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </header>

        {/* ── Main Content ── */}
        <main className="flex-1 relative z-10">
          {children}
        </main>

        {/* ── Footer ── */}
        <footer className="border-t border-[var(--border)] py-10 px-6 relative z-10">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded border border-[var(--gold)]/40 flex items-center justify-center">
                <span className="font-mono text-[var(--gold)] font-bold text-[9px]">M</span>
              </div>
              <span className="hud-label text-[var(--ink-dim)]">
                Milaan Autonomous Reconciliation Engine
              </span>
            </div>
            <div className="flex items-center gap-6">
              {["Fellegi-Sunter", "Hungarian O(n³)", "Benford χ²", "Isotonic Calibration"].map(t => (
                <span key={t} className="hud-label text-[var(--ink-dim)]">{t}</span>
              ))}
            </div>
          </div>
        </footer>

      </body>
    </html>
  );
}
