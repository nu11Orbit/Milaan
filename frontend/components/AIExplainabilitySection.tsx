"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Zap, ShieldCheck } from "lucide-react";

const AI_CARDS = [
  {
    icon: Brain,
    provider: "GEMINI 2.5 FLASH-LITE",
    title: "Primary AI Adjudicator",
    detail:
      "Invoked only on medium-confidence ambiguous records. Proposes a plain-English explanation + a bounded confidence delta. Never makes the final accept/reject call alone.",
    accent: "#2C2010",
    accentText: "#C9935A",
    tag: "GOOGLE DEEPMIND",
  },
  {
    icon: Zap,
    provider: "GROQ LLAMA 3.3 70B",
    title: "Automatic Failover",
    detail:
      "Seamless failover when Gemini rate-limits mid-batch. Exponential backoff, circuit breaker, and graceful degradation ensure the batch completes even if both LLM providers are exhausted.",
    accent: "#1A2218",
    accentText: "#7A9B80",
    tag: "GROQ INFERENCE",
  },
  {
    icon: ShieldCheck,
    provider: "SCHEMA-VALIDATED AUDITED",
    title: "Bounded and Explainable",
    detail:
      "Every LLM response is validated with Pydantic, stored as raw_llm_response in the audit log, and capped at a bounded confidence delta. Hallucinations cannot silently corrupt the ledger.",
    accent: "#252015",
    accentText: "#C4B898",
    tag: "AUDIT TRAIL",
  },
];

export default function AIExplainabilitySection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="ai-layer"
      ref={sectionRef}
      className="w-full bg-[#15120E] text-[#EDE6D6] py-24 sm:py-32 select-none"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-12">

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16 pb-8 border-b border-[rgba(237,230,214,0.08)]">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-[#B4875A] mb-3">
              06 / AI ADJUDICATION LAYER
            </div>
            <h2 className="font-display text-4xl sm:text-5xl md:text-6xl font-light tracking-tight text-[#EDE6D6]">
              The Machine That{" "}
              <span className="italic text-[#B4875A]">Explains Itself</span>
            </h2>
          </div>
          <p className="font-body text-base text-[#A69A85] max-w-md leading-relaxed">
            Pass 5 invokes an LLM only on genuinely ambiguous records. AI
            enhances explanation quality. Deterministic code enforces the
            final decision.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {AI_CARDS.map((card, i) => {
            const Icon = card.icon;
            return (
              <div
                key={card.provider}
                style={{ transitionDelay: `${i * 130}ms` }}
                className={`relative p-8 rounded-2xl bg-[#1D1812] border border-[rgba(237,230,214,0.08)] hover:border-[rgba(180,135,90,0.4)] transition-all duration-700 transform flex flex-col gap-6 shadow-[0_4px_24px_rgba(21,18,14,0.5)] overflow-hidden ${
                  isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
                }`}
              >
                <div
                  className="absolute inset-0 pointer-events-none opacity-[0.06] rounded-2xl"
                  style={{
                    background: `radial-gradient(ellipse 70% 60% at 30% 30%, ${card.accent}, transparent 70%)`,
                  }}
                />

                <div className="relative z-10 flex items-start justify-between">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center border"
                    style={{
                      background: `${card.accent}99`,
                      borderColor: `${card.accentText}40`,
                    }}
                  >
                    <Icon className="w-5 h-5" style={{ color: card.accentText }} />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[#A69A85] px-3 py-1 rounded-full bg-[#15120E] border border-[rgba(180,135,90,0.18)]">
                    {card.tag}
                  </span>
                </div>

                <div className="relative z-10 flex flex-col gap-2">
                  <div
                    className="font-mono text-[11px] uppercase tracking-widest font-semibold"
                    style={{ color: card.accentText }}
                  >
                    {card.provider}
                  </div>
                  <h3 className="font-display font-medium text-xl text-[#EDE6D6]">
                    {card.title}
                  </h3>
                  <p className="font-body text-sm text-[#A69A85] leading-relaxed">
                    {card.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div
          className={`transition-all duration-700 delay-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div className="relative rounded-2xl bg-[#1D1812] border border-[rgba(180,135,90,0.22)] px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 overflow-hidden shadow-[0_4px_24px_rgba(21,18,14,0.5)]">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_10%_50%,rgba(46,74,56,0.12),transparent_70%)] pointer-events-none" />
            <div className="relative z-10 flex items-center gap-4">
              <span className="w-2.5 h-2.5 rounded-full bg-[#B4875A] animate-pulse flex-shrink-0" />
              <p className="font-mono text-sm text-[#EDE6D6] leading-relaxed">
                <span className="text-[#B4875A] font-bold">Design principle:</span>{" "}
                AI proposes. Deterministic code decides. LLM confidence adjustments are strictly bounded.
                The final accept / review / reject threshold is enforced by auditable, inspectable code.
                Hallucinations cannot silently pass a bad match.
              </p>
            </div>
            <div className="relative z-10 flex-shrink-0 font-mono text-[10px] uppercase tracking-widest text-[#A69A85] text-right hidden sm:block">
              PASS 5 / 5<br />
              LLM ADJUDICATION
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
