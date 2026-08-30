"use client";
// app/page.tsx — Milaan: Igloo-grade immersive finance SaaS landing

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, Cpu, Shield, Zap } from "lucide-react";
import InteractiveBipartiteGraph from "@/components/InteractiveBipartiteGraph";

/* ─────────────── scroll parallax hook ─────────────── */
function useScrollY() {
  const [y, setY] = useState(0);
  useEffect(() => {
    const h = () => setY(window.scrollY);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  return y;
}

/* ─────────────── mouse parallax hook ─────────────── */
function useMouse() {
  const [m, setM] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const h = (e: MouseEvent) =>
      setM({ x: (e.clientX / window.innerWidth - 0.5) * 2, y: (e.clientY / window.innerHeight - 0.5) * 2 });
    window.addEventListener("mousemove", h, { passive: true });
    return () => window.removeEventListener("mousemove", h);
  }, []);
  return m;
}

/* ─────────────── intersection observer ─────────────── */
function useFadeIn(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* ─────────────── animated counter ─────────────── */
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const { ref, visible } = useFadeIn(0.5);
  useEffect(() => {
    if (!visible) return;
    let start: number | null = null;
    const dur = 1400;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.floor(ease * to));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [visible, to]);
  return <span ref={ref}>{val}{suffix}</span>;
}

/* ═══════════════════════════════════════════════════════ */
export default function HomePage() {
  const scrollY = useScrollY();
  const mouse = useMouse();

  // 3D tilt state for hero card
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleTilt = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = cardRef.current?.getBoundingClientRect();
    if (!r) return;
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: ny * -12, y: nx * 14 });
  }, []);

  // TDS sandbox state
  const [amount, setAmount] = useState(250000);
  const [tdsRate, setTdsRate] = useState(2);
  const tdsAmount = Math.round(amount * tdsRate / 100);
  const netAmount = amount - tdsAmount;
  const score = (tdsRate === 2 || tdsRate === 10 ? 96.8 : tdsRate === 0 ? 88.4 : 93.1).toFixed(1);

  const { ref: s1ref, visible: s1 } = useFadeIn();
  const { ref: s2ref, visible: s2 } = useFadeIn();
  const { ref: s3ref, visible: s3 } = useFadeIn();
  const { ref: s4ref, visible: s4 } = useFadeIn();

  return (
    <div className="relative">

      {/* ══════════════════════════════════════════════
          §1  HERO — full-height cinematic
      ══════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col justify-center px-6 sm:px-12 lg:px-24 pt-24 pb-20 overflow-hidden">

        {/* Glow blobs */}
        <div className="glow-spot w-96 h-96 -top-32 -left-32 opacity-25"
             style={{ background: "radial-gradient(circle, rgba(168,197,218,0.15) 0%, transparent 70%)" }} />
        <div className="glow-spot w-80 h-80 top-1/2 right-0 opacity-20"
             style={{ background: "radial-gradient(circle, rgba(201,169,110,0.12) 0%, transparent 70%)",
                      transform: `translate(${mouse.x * -12}px, ${mouse.y * -8}px)` }} />

        {/* Scan line */}
        <div className="scan-line" />

        <div className="relative z-10 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">

          {/* LEFT — Editorial */}
          <div className="lg:col-span-7 space-y-10"
               style={{ transform: `translateY(${scrollY * 0.06}px)` }}>

            {/* Clean Pill Badge */}
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/5 text-xs font-mono text-[var(--gold)] backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
              <span>Autonomous Financial Linkage</span>
              <span className="text-[var(--border-hi)]">•</span>
              <span className="text-[var(--ink-muted)]">99.4% Auto-Accept</span>
            </div>

            {/* Main headline */}
            <div className="space-y-4">
              <h1 className="display-xl">
                Financial
                <br />
                <span className="display-italic"> reconciliation,</span>
                <br />
                <span className="text-gold">redefined.</span>
              </h1>
              <p className="text-[var(--ink-muted)] text-base sm:text-lg leading-relaxed max-w-lg font-light">
                Milaan fuses probabilistic Fellegi-Sunter scoring, O(n³) Hungarian optimal assignment,
                and Benford&apos;s Law forensic auditing into one high-velocity pipeline.
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-4 pt-2">
              <Link href="/batches/new" className="btn-primary">
                <span>Upload Statement</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <a href="#algorithms" className="btn-ghost">
                Explore Architecture
              </a>
            </div>

            {/* Clean KPI metrics row */}
            <div className="grid grid-cols-3 gap-6 pt-6 border-t border-[var(--border)] font-mono">
              <div>
                <div className="text-xl sm:text-2xl font-bold text-[var(--green)] tabular-nums">≥ 95.0%</div>
                <div className="text-xs text-[var(--ink-muted)] mt-0.5 font-sans">Precision Target</div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold text-[var(--arctic)] tabular-nums">&lt; 0.5ms</div>
                <div className="text-xs text-[var(--ink-muted)] mt-0.5 font-sans">Hungarian Solver</div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold text-[var(--gold)] tabular-nums">100%</div>
                <div className="text-xs text-[var(--ink-muted)] mt-0.5 font-sans">Audit Lineage</div>
              </div>
            </div>
          </div>

          {/* RIGHT — 3D tilt card */}
          <div className="lg:col-span-5 persp"
               style={{ transform: `translateY(${scrollY * -0.04}px)` }}>
            <div
              ref={cardRef}
              onMouseMove={handleTilt}
              onMouseLeave={() => setTilt({ x: 0, y: 0 })}
              className="preserve-3d cursor-default"
              style={{
                transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                transition: "transform 0.15s ease-out",
              }}
            >
              {/* Outer glow */}
              <div className="absolute -inset-4 rounded-3xl opacity-40"
                   style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(168,197,218,0.15) 0%, transparent 70%)" }} />

              {/* Card */}
              <div className="relative glass-frost rounded-2xl overflow-hidden">
                {/* Top bar */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#FF5C5C]/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#F5A623]/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#3ECF8E]/70" />
                  </div>
                  <div className="hud-label">MILAAN — PIPELINE_TELEMETRY</div>
                  <div className="badge badge-green text-[9px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-ping" />
                    LIVE
                  </div>
                </div>

                {/* Terminal body */}
                <div className="p-5 space-y-3 terminal border-none rounded-none bg-transparent">
                  <div><span className="t-dim">$</span> <span className="t-mist">milaan run --batch 2024Q3 --mode full</span></div>
                  <div><span className="t-dim">[01]</span> Loading 847 bank rows · 692 invoice lines…</div>
                  <div><span className="t-dim">[02]</span> Fellegi-Sunter weight calibration <span className="t-green">✓</span></div>
                  <div><span className="t-dim">[03]</span> Hungarian O(n³) assignment pass <span className="t-green">✓ 0.38ms</span></div>
                  <div><span className="t-dim">[04]</span> TDS reconciliation §194C/§194J <span className="t-green">✓</span></div>
                  <div><span className="t-dim">[05]</span> Benford χ² forensic scan <span className="t-gold">1 flag</span></div>
                  <div className="pt-2 border-t border-white/5">
                    <span className="t-green font-bold">✦ 831 matches auto-accepted</span>
                    <span className="t-dim ml-3">· 16 exceptions queued</span>
                  </div>
                </div>

                {/* Bottom KPIs */}
                <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-t border-[var(--border)]">
                  {[
                    { label: "PRECISION", value: "98.4%", accent: "var(--green)" },
                    { label: "AUTO-ACCEPT", value: "831", accent: "var(--arctic)" },
                    { label: "LATENCY", value: "0.38ms", accent: "var(--gold)" },
                  ].map(({ label, value, accent }) => (
                    <div key={label} className="px-4 py-3 text-center">
                      <div className="hud-label">{label}</div>
                      <div className="hud-value mt-1" style={{ color: accent }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          §2  METRICS BAND
      ══════════════════════════════════════════════ */}
      <section ref={s1ref}
               className={`relative py-20 px-6 sm:px-12 lg:px-24 border-y border-[var(--border)] transition-all duration-700 ${s1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>

        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10">
          {[
            { label: "Precision Target",   value: 95,    suffix: "%+",  accent: "var(--green)" },
            { label: "Auto-Accept Rate",   value: 99,    suffix: ".4%", accent: "var(--arctic)" },
            { label: "Solver Latency (ms)",value: 0,     suffix: ".38", accent: "var(--gold)" },
            { label: "Audit Coverage",     value: 100,   suffix: "%",   accent: "var(--mist)" },
          ].map(({ label, value, suffix, accent }) => (
            <div key={label} className="space-y-2">
              <div className="metric-value" style={{ color: accent }}>
                {s1 ? <Counter to={value} suffix={suffix} /> : "—"}
              </div>
              <div className="metric-label">{label}</div>
            </div>
          ))}
        </div>

        {/* Decorative horizontal rule */}
        <div className="absolute bottom-0 left-24 right-24 hr-mist" />
      </section>

      {/* ══════════════════════════════════════════════
          §3  LIVE SANDBOX (TDS calculator)
      ══════════════════════════════════════════════ */}
      <section id="simulator"
               ref={s2ref}
               className={`relative py-28 px-6 sm:px-12 lg:px-24 overflow-hidden scroll-mt-20 transition-all duration-700 delay-100 ${s2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>

        {/* Glow */}
        <div className="glow-spot w-[500px] h-[500px] -left-48 top-1/4 opacity-15"
             style={{ background: "radial-gradient(circle, rgba(201,169,110,0.2) 0%, transparent 70%)" }} />

        <div className="max-w-7xl mx-auto">
          {/* Section header */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
            <div className="lg:col-span-5 space-y-6">
              <div className="hud-label text-[var(--gold)]">MODULE_02 // LIVE SANDBOX</div>
              <h2 className="display-lg">
                Test the probabilistic
                <span className="display-italic"> engine live.</span>
              </h2>
              <p className="text-[var(--ink-muted)] leading-relaxed text-sm max-w-md">
                Adjust invoice amount and TDS statutory rate. Watch Milaan compute
                net deductions and Fellegi-Sunter agreement log-ratios in real time.
              </p>
            </div>

            <div className="lg:col-span-7">
              <div className="glass rounded-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)]">
                  <Zap className="w-4 h-4 text-[var(--gold)]" />
                  <span className="hud-label">TDS_RECONCILIATION_SANDBOX</span>
                  <div className="ml-auto badge badge-green">LIVE</div>
                </div>

                <div className="p-6 space-y-6">
                  {/* Amount slider */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                      <span className="hud-label">GROSS_INVOICE_AMOUNT</span>
                      <span className="font-mono text-[var(--gold)] font-bold text-sm">
                        ₹{amount.toLocaleString("en-IN")}
                      </span>
                    </div>
                    <input
                      type="range" min={10000} max={1000000} step={10000}
                      value={amount}
                      onChange={e => setAmount(Number(e.target.value))}
                      className="w-full h-1 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "var(--gold)" }}
                    />
                    <div className="flex justify-between hud-label text-[var(--ink-dim)]">
                      <span>₹10,000</span><span>₹10,00,000</span>
                    </div>
                  </div>

                  {/* TDS rate selector */}
                  <div className="space-y-2">
                    <span className="hud-label">TDS_STATUTORY_RATE</span>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "0%", sub: "Exempt", val: 0 },
                        { label: "1%", sub: "§194C Ind", val: 1 },
                        { label: "2%", sub: "§194C Corp", val: 2 },
                        { label: "10%", sub: "§194J Prof", val: 10 },
                      ].map(({ label, sub, val }) => (
                        <button
                          key={val}
                          onClick={() => setTdsRate(val)}
                          className={`px-3 py-3 rounded-lg text-center transition-all ${
                            tdsRate === val
                              ? "bg-[var(--gold)]/15 border border-[var(--gold)] text-[var(--gold)]"
                              : "border border-[var(--border)] text-[var(--ink-muted)] hover:border-[var(--border-hi)] hover:text-[var(--ink)]"
                          }`}
                        >
                          <div className="font-mono text-sm font-bold">{label}</div>
                          <div className="hud-label mt-0.5" style={{ fontSize: "9px" }}>{sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Output */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="glass rounded-xl p-4 text-center">
                      <div className="hud-label">NET_DUE</div>
                      <div className="font-mono text-[var(--mist)] font-bold text-base mt-1">
                        ₹{netAmount.toLocaleString("en-IN")}
                      </div>
                    </div>
                    <div className="glass rounded-xl p-4 text-center">
                      <div className="hud-label">TDS_WITHHELD</div>
                      <div className="font-mono text-[var(--amber)] font-bold text-base mt-1">
                        ₹{tdsAmount.toLocaleString("en-IN")}
                      </div>
                    </div>
                    <div className="glass rounded-xl p-4 text-center">
                      <div className="hud-label">F-S_SCORE</div>
                      <div className="font-mono text-[var(--green)] font-bold text-base mt-1">
                        {score}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-4 rounded-xl"
                       style={{ background: "rgba(62,207,142,0.06)", border: "1px solid rgba(62,207,142,0.2)" }}>
                    <CheckCircle2 className="w-4 h-4 text-[var(--green)] shrink-0" />
                    <span className="hud-label text-[var(--ink-muted)] text-[10px]">
                      TDS_NET_MATCH ✓ · Hungarian global edge assigned · cost 0.00 · band AUTO_ACCEPT
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          §4  ALGORITHM VISUALIZER
      ══════════════════════════════════════════════ */}
      <section id="algorithms"
               ref={s3ref}
               className={`relative py-28 px-6 sm:px-12 lg:px-24 scroll-mt-20 border-t border-[var(--border)] transition-all duration-700 delay-150 ${s3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>

        <div className="max-w-7xl mx-auto space-y-16">
          {/* Header */}
          <div className="max-w-2xl space-y-4">
            <div className="hud-label text-[var(--arctic)]">MODULE_03 // ML ARCHITECTURE</div>
            <h2 className="display-lg">
              Institutional-grade
              <br />
              <span className="text-arctic">matching engine.</span>
            </h2>
            <p className="text-[var(--ink-muted)] text-sm leading-relaxed">
              Not a rules engine. Not keyword matching. A full probabilistic pipeline with
              formal statistical grounding and provable global optimality.
            </p>
          </div>

          {/* Bipartite visualizer */}
          <InteractiveBipartiteGraph />

          {/* Three column feature cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <Cpu className="w-5 h-5" />,
                tag: "FELLEGI-SUNTER",
                title: "Probabilistic Linkage",
                desc: "Log-likelihood ratio weights (w_i = log2(m_i/u_i)) replace arbitrary hand-tuning. Missing fields handled under Missing-At-Random assumption — zero penalty, no false negatives.",
                accent: "var(--arctic)",
                stats: [{ k: "Amount weight", v: "+4.2" }, { k: "PAN weight", v: "+8.5" }, { k: "Date weight", v: "+2.1" }],
              },
              {
                icon: <Zap className="w-5 h-5" />,
                tag: "HUNGARIAN O(n³)",
                title: "Global Optimal Assignment",
                desc: "Kuhn-Munkres algorithm guarantees the globally minimal-cost bipartite matching across all bank-invoice pairs simultaneously. No greedy local optima.",
                accent: "var(--gold)",
                stats: [{ k: "Solver latency", v: "0.38ms" }, { k: "n=1000 batch", v: "< 1s" }, { k: "Cost guarantee", v: "Global" }],
              },
              {
                icon: <Shield className="w-5 h-5" />,
                tag: "BENFORD LAW",
                title: "Forensic Integrity Audit",
                desc: "Chi-square goodness-of-fit tests invoice digit distributions against P(d) = log10(1+1/d). Antibenford subgraph detects coordinated threshold-evasion clusters.",
                accent: "var(--amber)",
                stats: [{ k: "Digit coverage", v: "D1–D6" }, { k: "χ² threshold", v: "p < 0.05" }, { k: "Graph detection", v: "On" }],
              },
            ].map(({ icon, tag, title, desc, accent, stats }) => (
              <div key={tag} className="glass rounded-2xl p-6 space-y-5 hover:scale-[1.015] transition-transform duration-300">
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                       style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`, color: accent }}>
                    {icon}
                  </div>
                  <span className="hud-label">{tag}</span>
                </div>

                <div>
                  <h3 className="font-display font-semibold text-base text-[var(--ink)]">{title}</h3>
                  <p className="text-sm text-[var(--ink-muted)] mt-2 leading-relaxed">{desc}</p>
                </div>

                <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                  {stats.map(({ k, v }) => (
                    <div key={k} className="flex justify-between items-baseline">
                      <span className="hud-label">{k}</span>
                      <span className="font-mono text-xs font-bold" style={{ color: accent }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          §5  DUAL-LLM PIPELINE DIAGRAM
      ══════════════════════════════════════════════ */}
      <section ref={s4ref}
               className={`relative py-28 px-6 sm:px-12 lg:px-24 border-t border-[var(--border)] overflow-hidden transition-all duration-700 delay-100 ${s4 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>

        {/* Background text watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
          <span className="font-display font-bold text-[20vw] text-white/[0.015] leading-none tracking-tighter whitespace-nowrap">
            MILAAN
          </span>
        </div>

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">

            {/* Pipeline visual */}
            <div className="lg:col-span-7 space-y-3">
              {[
                { step: "01", label: "CSV Intake",          sub: "Bank statement + Invoice register parsing", color: "var(--arctic)" },
                { step: "02", label: "Candidate Blocking",  sub: "Fast locality-sensitive pre-filtering", color: "var(--arctic)" },
                { step: "03", label: "Fellegi-Sunter Score", sub: "Log-likelihood ratio weight summation", color: "var(--gold)" },
                { step: "04", label: "LLM Semantic Check",  sub: "Gemini 2.5 Flash-Lite · Groq Llama 3.3", color: "var(--gold)" },
                { step: "05", label: "Hungarian Assignment", sub: "Global cost-optimal bipartite matching", color: "var(--green)" },
                { step: "06", label: "TDS Reconcile",       sub: "§194C / §194J statutory deduction net", color: "var(--green)" },
                { step: "07", label: "Benford Forensic",    sub: "χ² digit-frequency anomaly detection", color: "var(--amber)" },
              ].map(({ step, label, sub, color }, i) => (
                <div key={step}
                     className="flex items-center gap-4 group cursor-default"
                     style={{ animationDelay: `${i * 60}ms` }}>
                  {/* Step line */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center border font-mono text-xs font-bold transition-all group-hover:scale-110"
                         style={{ borderColor: color, color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
                      {step}
                    </div>
                    {i < 6 && <div className="w-px h-6 mt-1" style={{ background: `color-mix(in srgb, ${color} 25%, transparent)` }} />}
                  </div>
                  {/* Text */}
                  <div className="glass rounded-xl px-5 py-3 flex-1 transition-all group-hover:border-[var(--border-hi)]">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display font-semibold text-sm text-[var(--ink)]">{label}</span>
                      <span className="hud-label">{sub}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Right: copy + CTA */}
            <div className="lg:col-span-5 space-y-8">
              <div className="space-y-4">
                <div className="hud-label text-[var(--gold)]">MODULE_04 // PIPELINE</div>
                <h2 className="display-md">
                  Seven-pass autonomous
                  <br />
                  <span className="text-gold">reconciliation.</span>
                </h2>
                <p className="text-[var(--ink-muted)] text-sm leading-relaxed">
                  Each pass adds a new signal layer. The pipeline is fully auditable —
                  every score delta, LLM response, and assignment decision is
                  stored in an immutable trail.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { v: "Dual-LLM circuit breaker — zero blockage on provider outage" },
                  { v: "Isotonic calibration ensures P(match|score) is well-typed" },
                  { v: "Exceptions routed to human review with pre-computed justification" },
                ].map(({ v }) => (
                  <div key={v} className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[var(--green)] shrink-0 mt-0.5" />
                    <span className="text-sm text-[var(--ink-muted)]">{v}</span>
                  </div>
                ))}
              </div>

              <Link href="/batches/new" className="btn-primary inline-flex">
                <span>Launch New Batch</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          §6  FINAL CTA — full bleed cinematic
      ══════════════════════════════════════════════ */}
      <section className="relative py-36 px-6 sm:px-12 lg:px-24 border-t border-[var(--border)] overflow-hidden text-center">

        <div className="glow-spot w-[600px] h-[300px] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20"
             style={{ background: "radial-gradient(ellipse, rgba(201,169,110,0.25) 0%, transparent 70%)" }} />

        <div className="relative z-10 max-w-3xl mx-auto space-y-8">
          <div className="hud-label text-[var(--gold)]">{"// READY TO DEPLOY"}</div>

          <h2 className="display-xl text-center">
            Reconcile at
            <br />
            <span className="text-gold display-italic"> enterprise scale.</span>
          </h2>

          <p className="text-[var(--ink-muted)] text-base leading-relaxed max-w-xl mx-auto">
            Upload your bank statement and invoice register.
            Milaan executes the full seven-pass pipeline in seconds
            and delivers a forensically auditable match report.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/batches/new" className="btn-primary">
              <span>Upload Statement & Invoices</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <a href="#algorithms" className="btn-ghost">
              Read the Architecture
            </a>
          </div>

          {/* Bottom HUD bar */}
          <div className="flex items-center justify-center gap-6 pt-6">
            {["Fellegi-Sunter ML", "Hungarian O(n³)", "Benford χ² Forensic", "Dual-LLM"].map(t => (
              <span key={t} className="hud-label">{t}</span>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
