"use client";
// app/batches/[batchId]/matches/[matchId]/page.tsx — Modern FinTech Forensic Audit Trail

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAuditTrail, type AuditTrail, type AuditEntry } from "@/lib/api";
import { ShieldCheck, ArrowLeft, Bot } from "lucide-react";

const PASS_STYLING: Record<string, { label: string; bg: string; text: string; border: string }> = {
  pass1_rules: { label: "Pass 1 · Rules", bg: "rgba(16, 185, 129, 0.12)", text: "#34D399", border: "rgba(16, 185, 129, 0.35)" },
  pass2_fuzzy: { label: "Pass 2 · Fuzzy", bg: "rgba(6, 182, 212, 0.12)", text: "#22D3EE", border: "rgba(6, 182, 212, 0.35)" },
  pass3_embedding: { label: "Pass 3 · Embedding", bg: "rgba(99, 102, 241, 0.12)", text: "#818CF8", border: "rgba(99, 102, 241, 0.35)" },
  pass4_split_matcher: { label: "Pass 4 · Split Match", bg: "rgba(245, 158, 11, 0.12)", text: "#FBBF24", border: "rgba(245, 158, 11, 0.35)" },
  pass5_llm: { label: "Pass 5 · LLM Adjudicator", bg: "rgba(16, 185, 129, 0.18)", text: "#F8FAFC", border: "rgba(16, 185, 129, 0.5)" },
  pass5_llm_retry: { label: "Pass 5 · LLM Retry", bg: "rgba(6, 182, 212, 0.18)", text: "#22D3EE", border: "rgba(6, 182, 212, 0.5)" },
  hungarian_reassignment: { label: "Hungarian Global Optimizer", bg: "rgba(16, 185, 129, 0.15)", text: "#34D399", border: "rgba(16, 185, 129, 0.45)" },
  confidence_scorer: { label: "Confidence Scorer", bg: "rgba(30, 41, 59, 0.8)", text: "#94A3B8", border: "rgba(255, 255, 255, 0.1)" },
  human_review: { label: "Human Review", bg: "rgba(16, 185, 129, 0.12)", text: "#34D399", border: "rgba(16, 185, 129, 0.35)" },
};

export default function MatchDetailPage() {
  const { batchId, matchId } = useParams<{ batchId: string; matchId: string }>();
  const [audit, setAudit] = useState<AuditTrail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditTrail(matchId).then(setAudit).finally(() => setLoading(false));
  }, [matchId]);

  if (loading) return <Loading />;
  if (!audit) return <p className="text-rose-400 font-mono">Audit trail record not found.</p>;

  const bandClass =
    audit.confidence_band === "auto_accept"
      ? "band-auto"
      : audit.confidence_band === "review"
      ? "band-review"
      : "band-reject";

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-2">
      {/* Back to Results */}
      <div>
        <Link
          href={`/batches/${batchId}/results`}
          className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-400 hover:text-emerald-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Ledger Results</span>
        </Link>
      </div>

      {/* Match summary header card */}
      <div className="glass-panel rounded-2xl p-6 border border-white/10 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Immutable Ledger Match Lineage</span>
            </div>
            <h1 className="font-mono text-xl sm:text-2xl font-bold text-white mt-1">{audit.match_id}</h1>
            <p className="text-slate-400 text-xs font-mono capitalize mt-0.5">
              Type: {audit.match_type.replace(/_/g, " ")}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-3xl font-extrabold font-mono text-emerald-400 tabular-nums">
              {audit.confidence_score.toFixed(1)}
            </div>
            <span className={`inline-block px-3 py-0.5 rounded-full text-xs font-mono font-semibold uppercase mt-1 ${bandClass}`}>
              {audit.confidence_band.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        {audit.explanation_text && (
          <div className="bg-slate-950/80 rounded-xl p-4 border border-white/[0.06] space-y-1">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-semibold">Decision Narrative</div>
            <p className="text-xs text-slate-200 leading-relaxed font-sans">{audit.explanation_text}</p>
          </div>
        )}

        <div className="text-[11px] font-mono text-slate-400 flex flex-wrap gap-x-6 gap-y-1 pt-2 border-t border-white/[0.06]">
          <span>Auto-Accept Threshold: <strong className="text-slate-200">{audit.threshold_snapshot?.auto_accept ?? "—"}</strong></span>
          <span>Review Threshold: <strong className="text-slate-200">{audit.threshold_snapshot?.review ?? "—"}</strong></span>
        </div>
      </div>

      {/* Audit Trail Timeline */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            Sequential Pipeline Trail
          </h2>
          <span className="text-xs font-mono text-slate-400">
            {audit.audit_trail.length} execution step{audit.audit_trail.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="space-y-3">
          {audit.audit_trail.map((entry, i) => (
            <AuditCard key={entry.log_id} entry={entry} step={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditCard({ entry, step }: { entry: AuditEntry; step: number }) {
  const [expanded, setExpanded] = useState(false);
  const style = PASS_STYLING[entry.pass_name] ?? {
    label: entry.pass_name.replace(/_/g, " "),
    bg: "rgba(30, 41, 59, 0.8)",
    text: "#94A3B8",
    border: "rgba(255, 255, 255, 0.1)",
  };

  return (
    <div className="glass-panel rounded-2xl p-5 shadow space-y-3 border border-white/[0.08] hover:border-emerald-500/30 transition-colors">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-500 w-5 text-right font-bold">{step}</span>
          <span
            className="text-xs font-mono px-3 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
          >
            {style.label}
          </span>
          {entry.score_delta != null && (
            <span
              className={`text-xs font-mono font-bold tabular-nums ${
                entry.score_delta >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {entry.score_delta >= 0 ? "+" : ""}
              {entry.score_delta.toFixed(1)} pts
            </span>
          )}
          {entry.score_after != null && (
            <span className="text-xs font-mono text-[var(--arctic)] tabular-nums">
              → Score: {entry.score_after.toFixed(1)}
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono text-slate-500">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {entry.reasoning_text && (
        <p className="text-xs text-slate-300 pl-8 leading-relaxed font-sans">{entry.reasoning_text}</p>
      )}

      {/* LLM-Specific Section */}
      {entry.pass_name.startsWith("pass5_llm") && (
        <div className="pl-8 space-y-2 pt-1">
          <div className="flex items-center gap-2 text-xs font-mono">
            <Bot className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-100 font-semibold">
              {entry.llm_provider === "groq" ? "Groq Llama 3.3 (Fallback Circuit)" : "Gemini 2.5 Flash-Lite"}
            </span>
            {entry.llm_model && <span className="text-slate-500">· {entry.llm_model}</span>}
            {entry.llm_fallback_used && <span className="text-amber-400">· Fallback Active</span>}
            {entry.llm_both_failed && <span className="text-rose-400">· Both Failed</span>}
          </div>

          {entry.raw_llm_response && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs font-mono text-[var(--arctic)] hover:text-[var(--mist)] transition-colors underline cursor-pointer"
              >
                {expanded ? "▲ Collapse raw LLM payload" : "▼ Inspect raw LLM JSON response"}
              </button>
              {expanded && (
                <pre className="mt-2 bg-slate-950 border border-white/10 rounded-xl p-4 text-[11px] font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap leading-normal">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(entry.raw_llm_response!), null, 2);
                    } catch {
                      return entry.raw_llm_response;
                    }
                  })()}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="h-64 flex items-center justify-center space-y-2 flex-col">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      <span className="text-xs font-mono text-slate-400">Loading Forensic Audit Trail…</span>
    </div>
  );
}
