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
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--ink)] antialiased selection:bg-[var(--border-hi)]/20 selection:text-black overflow-x-hidden">

        {/* ── Dynamic 3D Workspace Canvas (Fixed Background) ── */}
        <MilaanCanvas />

        {/* ── Navigation Header ── */}
        <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-7 h-7 rounded-md flex items-center justify-center border border-[var(--border-hi)] group-hover:bg-[var(--border-hi)] transition-colors">
                <span className="font-mono text-[var(--border-hi)] group-hover:text-white font-bold text-xs transition-colors">M</span>
              </div>
              <span className="font-display font-semibold text-sm tracking-wide text-[var(--ink)]">
                Milaan
              </span>
            </Link>

            {/* Nav links */}
            <nav className="hidden md:flex items-center gap-1">
              {[
                { href: "/", label: "Overview" },
                { href: "/#architecture", label: "Architecture" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--border)]/30 transition-all"
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
        <footer className="border-t border-[var(--border)] py-10 px-6 relative z-10 bg-[var(--bg)]">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded border border-[var(--border-hi)] flex items-center justify-center">
                <span className="font-mono text-[var(--border-hi)] font-bold text-[9px]">M</span>
              </div>
              <span className="hud-label text-[var(--ink-muted)]">
                Milaan Autonomous Reconciliation Engine
              </span>
            </div>
            <div className="flex items-center gap-6">
              {["Fellegi-Sunter", "Hungarian O(n³)", "Benford χ²", "Isotonic Calibration"].map(t => (
                <span key={t} className="hud-label text-[var(--ink-muted)]">{t}</span>
              ))}
            </div>
          </div>
        </footer>

      </body>
    </html>
  );
}
