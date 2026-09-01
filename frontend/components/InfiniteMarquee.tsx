"use client";

const PASSES = [
  { num: "01", name: "Deterministic Rule Matching", detail: "Exact UTR & PAN Netting" },
  { num: "02", name: "Fellegi-Sunter Probabilistic Linkage", detail: "Log-Likelihood Weight Vectors" },
  { num: "03", name: "Semantic & Phonetic Vendor Matching", detail: "Levenshtein & Embeddings" },
  { num: "04", name: "Kuhn-Munkres Bipartite Assignment", detail: "O(n³) Minimal Cost Optimization" },
  { num: "05", name: "Subset-Sum Combinatorial Split", detail: "Multi-Invoice Settlement" },
];

const DOMAIN_TAGS = [
  "SECTION 194C TDS",
  "SECTION 194J TDS",
  "GST RULE 36(4) ITC",
  "UPI AUTOPAY CLEARING",
  "NEFT & RTGS SETTLEMENT",
  "IMPS INSTANT LEDGER",
  "AS-9 REVENUE ACCRUAL",
  "SYNTHETIC BENCHMARK HARNESS",
];

export default function InfiniteMarquee() {
  return (
    <section id="pipeline" className="w-full py-16 bg-[#1D1812] border-y border-[rgba(237,230,214,0.08)] overflow-hidden select-none marquee-container">
      
      {/* ── ROW 1: 5 PASSES (Moving Left) ── */}
      <div className="flex w-max items-center gap-8 whitespace-nowrap animate-marquee-left mb-6">
        {[...PASSES, ...PASSES, ...PASSES].map((item, idx) => (
          <div
            key={idx}
            className="flex items-center gap-6 px-6 py-3 rounded-xl bg-[#251E16] border border-[rgba(180,135,90,0.25)] text-[#EDE6D6] shadow-[0_2px_10px_rgba(21,18,14,0.4)]"
          >
            <span className="font-mono text-sm font-bold text-[#B4875A] tabular-nums">
              PASS {item.num}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#2E4A38]" />
            <span className="font-display font-medium text-lg tracking-tight text-[#EDE6D6]">
              {item.name}
            </span>
            <span className="font-mono text-xs text-[#A69A85] hidden sm:inline">
              ({item.detail})
            </span>
          </div>
        ))}
      </div>

      {/* ── ROW 2: DOMAIN CONCEPTS (Moving Right) ── */}
      <div className="flex w-max items-center gap-6 whitespace-nowrap animate-marquee-right">
        {[...DOMAIN_TAGS, ...DOMAIN_TAGS, ...DOMAIN_TAGS].map((tag, idx) => (
          <div
            key={idx}
            className="flex items-center gap-4 px-5 py-2 rounded-full bg-[#15120E] border border-[rgba(237,230,214,0.08)] text-[#A69A85]"
          >
            <span className="w-1 h-1 rounded-full bg-[#B4875A]" />
            <span className="font-mono text-xs uppercase tracking-widest text-[#A69A85]">
              {tag}
            </span>
          </div>
        ))}
      </div>

    </section>
  );
}
