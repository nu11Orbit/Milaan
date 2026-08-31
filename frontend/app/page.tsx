"use client";
import Link from "next/link";
import { ArrowRight, Cpu, Shield, Zap, FileSpreadsheet, GitMerge, Lock } from "lucide-react";
import { motion } from "framer-motion";
import InteractiveBipartiteGraph from "@/components/InteractiveBipartiteGraph";

export default function HomePage() {
  // Common motion variants for text blocks
  const textMotion = {
    initial: { opacity: 0, y: 30 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-100px" },
    transition: { duration: 1.0 }
  };

  return (
    <div className="relative z-10 bg-transparent flex flex-col items-center">
      
      {/* ══════════════════════════════════════════════
          §1  HERO: The Chaos
      ══════════════════════════════════════════════ */}
      <motion.section 
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.2 }}
        className="w-full min-h-[110vh] flex flex-col justify-center px-6 sm:px-12 lg:px-24"
      >
        <div className="max-w-4xl mx-auto text-center space-y-8 mt-20">
          
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] text-xs font-mono text-[var(--ink)] shadow-md mx-auto">
            <span className="w-2 h-2 rounded-full bg-[var(--neon-blue)] animate-pulse shadow-[0_0_8px_var(--neon-blue)]" />
            <span>Phase I: Ingestion & Chaos</span>
          </div>

          <h1 className="display-xl text-[var(--ink)] leading-tight">
            Financial data is <span className="italic font-light text-[var(--ink-muted)]">chaotic.</span> <br />
            Reconciliation shouldn't be.
          </h1>
          
          <p className="text-[var(--ink-muted)] text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto font-light">
            Every month, thousands of invoices clash against unstructured bank statements. Manual teams rely on brittle Excel VLOOKUPs, rigid regex rules, and human intuition to find the signal in the noise.
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-8">
            <Link href="/batches/new" className="btn-primary">
              <span>Start Autonomous Pipeline</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#pipeline" className="btn-ghost">
              Explore the Engine
            </a>
          </div>
        </div>
      </motion.section>

      {/* ══════════════════════════════════════════════
          §2  THE PROBLEM (New Section)
      ══════════════════════════════════════════════ */}
      <motion.section 
        {...textMotion}
        id="pipeline"
        className="w-full min-h-[100vh] flex flex-col justify-center px-6 sm:px-12 lg:px-24 mb-32"
      >
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div className="space-y-6">
            <div className="hud-label text-[var(--amber)]">{"// THE BOTTLENECK"}</div>
            <h2 className="display-lg">Brittle rules fail at scale.</h2>
            <p className="text-[var(--ink-muted)] text-lg leading-relaxed">
              When an RTGS payment hits the bank with truncated narrations (e.g., "NEFT-INFOSYS-INVOICE9" instead of "INV-2024-009"), exact matching fails instantly. Deductions like 10% TDS under §194J cause the amounts to mismatch completely.
            </p>
            <p className="text-[var(--ink-muted)] text-lg leading-relaxed">
              Milaan abandons rules for a purely probabilistic model. By applying Fellegi-Sunter log-likelihoods, we calculate the mathematical probability that any bank row matches any ERP invoice, regardless of missing details or tax deductions.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {[
              { icon: <FileSpreadsheet className="w-5 h-5 text-[var(--red)]"/>, text: "VLOOKUP matching fails on partial narrations." },
              { icon: <Zap className="w-5 h-5 text-[var(--gold)]"/>, text: "TDS deductions break exact amount matching." },
              { icon: <Cpu className="w-5 h-5 text-[var(--green)]"/>, text: "Manual resolution costs $8 per exception." }
            ].map((err, i) => (
              <div key={i} className="card-standard p-5 flex items-center gap-4 bg-[var(--bg-surface-elevated)]">
                <div className="p-2 rounded bg-[var(--bg)] border border-[var(--border)]">{err.icon}</div>
                <div className="font-mono text-sm">{err.text}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ══════════════════════════════════════════════
          §3  LIVE TERMINAL: Bipartite Matching
      ══════════════════════════════════════════════ */}
      <motion.section 
        {...textMotion}
        className="w-full min-h-[100vh] flex flex-col justify-center px-6 sm:px-12 lg:px-24 mb-32"
      >
        <div className="max-w-4xl mx-auto space-y-12">
          
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] text-xs font-mono text-[var(--ink)] shadow-md mx-auto">
              <span className="w-2 h-2 rounded-full bg-[var(--gold)] animate-pulse shadow-[0_0_8px_var(--gold)]" />
              <span>Phase II: O(n³) Neural Assignment</span>
            </div>
            <h2 className="display-lg">The Hungarian Matrix.</h2>
            <p className="text-[var(--ink-muted)] text-lg max-w-2xl mx-auto leading-relaxed">
              Once probabilities are calculated, assigning them greedily creates collisions. Milaan uses the Kuhn-Munkres (Hungarian) algorithm to find the globally optimal bipartite matching across the entire dataset in sub-milliseconds.
            </p>
          </div>

          <div className="card-standard shadow-2xl border-[var(--border-hi)] relative group">
            {/* Cyber glow behind terminal */}
            <div className="absolute -inset-1 bg-gradient-to-b from-[var(--neon-blue)] to-[var(--gold)] rounded-xl blur opacity-10 group-hover:opacity-20 transition duration-1000"></div>
            
            <div className="relative bg-[var(--bg-surface)] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-surface-elevated)]">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#ef4444]" />
                  <div className="w-3 h-3 rounded-full bg-[#f59e0b]" />
                  <div className="w-3 h-3 rounded-full bg-[#10b981]" />
                </div>
                <div className="hud-label text-[10px] text-[var(--ink-dim)]">MILAAN PIPELINE EXECUTION</div>
                <div className="badge badge-green text-[9px] shadow-[0_0_10px_rgba(16,185,129,0.2)]">LIVE</div>
              </div>

              <div className="p-6 font-mono text-sm leading-loose">
                <div><span className="t-dim">$</span> <span className="t-mist">milaan run --batch 2024Q3 --mode full</span></div>
                <div className="mt-2"><span className="t-dim">[01]</span> Loading 847 bank rows · 692 invoice lines…</div>
                <div><span className="t-dim">[02]</span> Fellegi-Sunter weight calibration <span className="t-green">✓</span></div>
                <div><span className="t-dim">[03]</span> Hungarian O(n³) assignment pass <span className="t-green">✓ 0.38ms</span></div>
                <div><span className="t-dim">[04]</span> TDS reconciliation §194C/§194J <span className="t-green">✓</span></div>
                <div><span className="t-dim">[05]</span> Benford χ² forensic scan <span className="text-[var(--gold)]">1 flag</span></div>
                <div className="pt-4 mt-4 border-t border-[var(--border)]">
                  <span className="t-green font-bold drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]">✦ 831 matches auto-accepted</span>
                  <span className="t-dim ml-3">· 16 exceptions queued</span>
                </div>
              </div>

              <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-t border-[var(--border)] bg-[var(--bg-surface-elevated)]">
                {[
                  { label: "PRECISION", value: "98.4%", color: "var(--green)" },
                  { label: "AUTO-ACCEPT", value: "831", color: "var(--border-hi)" },
                  { label: "LATENCY", value: "0.38ms", color: "var(--gold)" },
                ].map((stat) => (
                  <div key={stat.label} className="p-4 text-center">
                    <div className="hud-label text-[var(--ink-dim)]">{stat.label}</div>
                    <div className="font-mono text-xl font-bold mt-1 drop-shadow-md" style={{ color: stat.color }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ══════════════════════════════════════════════
          §4  INTERACTIVE GRAPH & STATS
      ══════════════════════════════════════════════ */}
      <motion.section 
        {...textMotion}
        className="w-full min-h-[100vh] flex flex-col justify-center px-6 sm:px-12 lg:px-24 mb-32"
      >
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="text-center space-y-4">
            <h2 className="display-lg">Provable Optimality.</h2>
            <p className="text-[var(--ink-muted)] text-lg max-w-2xl mx-auto leading-relaxed">
              Experience the matching engine firsthand. The Hungarian algorithm guarantees the minimal-cost bipartite matching without falling into local minima traps.
            </p>
          </div>

          <div className="card-standard p-2 shadow-2xl relative">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--bg-surface-elevated)] opacity-20 pointer-events-none rounded-2xl"></div>
            <InteractiveBipartiteGraph />
          </div>

          <div className="flex flex-col gap-32 pt-32 pb-16">
            {[
              {
                icon: <GitMerge className="w-8 h-8" />,
                tag: "FELLEGI-SUNTER",
                title: "Probabilistic Linkage.",
                desc: "Log-likelihood ratio weights replace arbitrary hand-tuning. Missing fields handled mathematically under the MAR assumption.",
                accent: "var(--neon-blue)",
              },
              {
                icon: <Zap className="w-8 h-8" />,
                tag: "HUNGARIAN O(n³)",
                title: "Global Assignment.",
                desc: "Kuhn-Munkres guarantees the globally minimal-cost bipartite matching across all pairs simultaneously.",
                accent: "var(--gold)",
              },
              {
                icon: <Lock className="w-8 h-8" />,
                tag: "BENFORD LAW",
                title: "Forensic Integrity.",
                desc: "Chi-square goodness-of-fit tests invoice digit distributions to detect coordinated threshold-evasion and fraud.",
                accent: "var(--red)",
              },
            ].map((feature, idx) => (
              <motion.div 
                key={feature.tag} 
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-20%" }}
                transition={{ duration: 1.0 }}
                className={`flex flex-col ${idx % 2 === 0 ? "items-start text-left" : "items-end text-right"} max-w-xl ${idx % 2 === 0 ? "mr-auto" : "ml-auto"}`}
              >
                <div className="mb-6 drop-shadow-lg" style={{ color: feature.accent }}>
                  {feature.icon}
                </div>
                <div className="hud-label tracking-[0.25em] mb-4 drop-shadow-md" style={{ color: feature.accent }}>
                  {feature.tag}
                </div>
                <h3 className="display-lg mb-6 text-white leading-none drop-shadow-2xl">
                  {feature.title}
                </h3>
                <p className="text-[var(--ink-muted)] text-xl font-light leading-relaxed bg-black/20 backdrop-blur-[2px] p-4 rounded-2xl">
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ══════════════════════════════════════════════
          §5  CTA: Order from Chaos
      ══════════════════════════════════════════════ */}
      <motion.section 
        {...textMotion}
        className="w-full min-h-[100vh] flex flex-col justify-center px-6 sm:px-12 lg:px-24 pb-32"
      >
        <div className="max-w-4xl mx-auto text-center space-y-8 card-standard p-16 border-[var(--gold)] shadow-[0_0_50px_rgba(251,191,36,0.1)] relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-tr from-[var(--bg-surface)] to-[#15130b] z-0"></div>
          
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border border-[var(--gold)] bg-[#2a220b] text-xs font-mono text-[var(--gold)] shadow-md mx-auto mb-8">
              <span className="w-2 h-2 rounded-full bg-[var(--gold)] animate-pulse shadow-[0_0_8px_var(--gold)]" />
              <span>Phase III: Clean Export</span>
            </div>
            
            <h2 className="display-lg">
              Reconcile at <span className="text-[var(--gold)] drop-shadow-[0_0_15px_rgba(251,191,36,0.4)]">enterprise scale.</span>
            </h2>
            
            <p className="text-[var(--ink-muted)] text-lg max-w-xl mx-auto mt-6">
              Upload your raw bank statement and invoice register. Milaan automatically executes the full seven-pass pipeline in sub-seconds.
            </p>
            
            <div className="pt-10">
              <Link href="/batches/new" className="btn-primary !bg-[var(--gold)] !text-black hover:!bg-white">
                <span>Deploy Autonomous Engine</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </motion.section>

    </div>
  );
}
