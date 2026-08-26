// app/page.tsx — Landing / overview
import Link from "next/link";

const ARCH = [
  { n: "01", label: "Pass 1 — Rules Engine",   desc: "GST formula, TDS section, UTR exact match, date proximity" },
  { n: "02", label: "Pass 2 — Fuzzy Match",     desc: "RapidFuzz token_sort_ratio on counterparty name / narration" },
  { n: "03", label: "Pass 3 — Embedding",       desc: "all-MiniLM-L6-v2 cosine similarity for deep semantic matching" },
  { n: "04", label: "Pass 4 — Split/Batch",     desc: "Subset-sum in paise (integer) for split settlements & batch payouts" },
  { n: "05", label: "Pass 5 — LLM Adjudicator", desc: "Gemini 2.5 Flash-Lite → Groq Llama 3.3 fallback with circuit breakers" },
];

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="text-center py-16 space-y-4">
        <div className="inline-block bg-blue-900/30 border border-blue-700/40 text-blue-300 text-xs px-3 py-1 rounded-full mb-2">
          Razorpay AI Buildathon · Track 04
        </div>
        <h1 className="text-5xl font-bold text-white leading-tight">
          GST/TDS-Aware<br />
          <span className="text-blue-400">Reconciliation Engine</span>
        </h1>
        <p className="text-slate-400 max-w-xl mx-auto text-lg">
          5-pass AI pipeline that reconciles bank statements against invoices —
          handling split settlements, TDS deductions, GST rounding, and
          escalating ambiguous cases to an LLM adjudicator with a full audit trail.
        </p>
        <div className="flex justify-center gap-4 pt-4">
          <Link
            href="/batches/new"
            className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-6 py-3 rounded-lg transition-colors"
          >
            Start Reconciliation →
          </Link>
        </div>
      </section>

      {/* 5-pass pipeline diagram */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Pipeline Architecture</h2>
        <div className="grid grid-cols-1 gap-3">
          {ARCH.map((step, i) => (
            <div key={step.n} className="flex items-start gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-blue-700/50 transition-colors">
              <span className="text-blue-400 font-mono text-sm font-bold mt-0.5 shrink-0">{step.n}</span>
              <div>
                <div className="text-white font-medium text-sm">{step.label}</div>
                <div className="text-slate-400 text-xs mt-0.5">{step.desc}</div>
              </div>
              {i < ARCH.length - 1 && (
                <div className="ml-auto text-slate-700 text-xs shrink-0 mt-1">→ next pass if unresolved</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Key stats */}
      <section className="grid grid-cols-3 gap-4">
        {[
          { label: "Precision Target", value: "≥ 95%", sub: "auto-accept band" },
          { label: "Recall Target",    value: "≥ 90%", sub: "reconciliation events" },
          { label: "Exception Completeness", value: "100%", sub: "every unmatched has a reason" },
        ].map((s) => (
          <div key={s.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 text-center">
            <div className="text-3xl font-bold text-blue-400">{s.value}</div>
            <div className="text-white text-sm font-medium mt-1">{s.label}</div>
            <div className="text-slate-500 text-xs mt-0.5">{s.sub}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
