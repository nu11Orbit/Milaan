"use client";
// app/batches/[batchId]/matches/[matchId]/page.tsx — Forensic Match Audit Trail

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAuditTrail, type AuditTrail, type AuditEntry } from "@/lib/api";
import { ShieldCheck, ArrowLeft, Bot } from "lucide-react";

const PASS_STYLING: Record<string, { label: string; bg: string; text: string; border: string }> = {
  pass1_rules: { label: "Pass 1 · Rules", bg: "rgba(60, 107, 76, 0.15)", text: "#7AAE88", border: "rgba(60, 107, 76, 0.35)" },
  pass2_fuzzy: { label: "Pass 2 · Fuzzy", bg: "rgba(180, 135, 90, 0.15)", text: "#B4875A", border: "rgba(180, 135, 90, 0.35)" },
  pass3_embedding: { label: "Pass 3 · Embedding", bg: "rgba(166, 154, 133, 0.15)", text: "#EDE6D6", border: "rgba(166, 154, 133, 0.35)" },
  pass4_split_matcher: { label: "Pass 4 · Split Match", bg: "rgba(199, 154, 69, 0.15)", text: "#C79A45", border: "rgba(199, 154, 69, 0.35)" },
  pass5_llm: { label: "Pass 5 · LLM Adjudicator", bg: "rgba(60, 107, 76, 0.20)", text: "#EDE6D6", border: "rgba(180, 135, 90, 0.45)" },
  pass5_llm_retry: { label: "Pass 5 · LLM Retry", bg: "rgba(180, 135, 90, 0.20)", text: "#B4875A", border: "rgba(180, 135, 90, 0.5)" },
  hungarian_reassignment: { label: "Hungarian Global Optimizer", bg: "rgba(60, 107, 76, 0.18)", text: "#7AAE88", border: "rgba(60, 107, 76, 0.45)" },
  confidence_scorer: { label: "Confidence Scorer", bg: "rgba(37, 30, 22, 0.8)", text: "#A69A85", border: "rgba(237, 230, 214, 0.1)" },
  human_review: { label: "Human Review", bg: "rgba(180, 135, 90, 0.15)", text: "#B4875A", border: "rgba(180, 135, 90, 0.35)" },
};

export default function MatchDetailPage() {
  const { batchId, matchId } = useParams<{ batchId: string; matchId: string }>();
  const [audit, setAudit] = useState<AuditTrail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditTrail(matchId).then(setAudit).finally(() => setLoading(false));
  }, [matchId]);

  if (loading) return <Loading />;
  if (!audit) return (
    <div className="pt-28 pb-16 px-4 max-w-4xl mx-auto">
      <p className="font-mono text-xs" style={{ color: "#C06050" }}>Audit trail record not found.</p>
    </div>
  );

  const isAuto = audit.confidence_band === "auto_accept";
  const isReview = audit.confidence_band === "review";

  return (
    <div className="space-y-6 max-w-4xl mx-auto pt-28 pb-16 px-4">
      {/* Back to Results */}
      <div>
        <Link
          href={`/batches/${batchId}/results`}
          className="inline-flex items-center gap-1.5 text-xs font-mono transition-colors hover:underline"
          style={{ color: "#A69A85" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Ledger Results</span>
        </Link>
      </div>

      {/* Match summary header card */}
      <div
        className="glass-panel rounded-2xl p-6 shadow-2xl space-y-4"
        style={{ border: "1px solid rgba(237,230,214,0.1)" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div
              className="inline-flex items-center gap-1.5 text-xs font-mono"
              style={{ color: "#7AAE88" }}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Immutable Ledger Match Lineage</span>
            </div>
            <h1
              className="font-mono text-xl sm:text-2xl font-bold mt-1"
              style={{ color: "#EDE6D6" }}
            >
              {audit.match_id}
            </h1>
            <p className="text-xs font-mono capitalize mt-0.5" style={{ color: "#A69A85" }}>
              Type: {audit.match_type.replace(/_/g, " ")}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <div
              className="text-3xl font-extrabold font-mono tabular-nums"
              style={{ color: isAuto ? "#7AAE88" : isReview ? "#C79A45" : "#C06050" }}
            >
              {audit.confidence_score.toFixed(1)}
            </div>
            <span
              className="inline-block px-3 py-0.5 rounded-full text-xs font-mono font-semibold uppercase mt-1"
              style={
                isAuto
                  ? { background: "rgba(60,107,76,0.15)", color: "#7AAE88", border: "1px solid rgba(60,107,76,0.35)" }
                  : isReview
                  ? { background: "rgba(199,154,69,0.15)", color: "#C79A45", border: "1px solid rgba(199,154,69,0.35)" }
                  : { background: "rgba(163,76,63,0.15)", color: "#C06050", border: "1px solid rgba(163,76,63,0.35)" }
              }
            >
              {audit.confidence_band.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        {audit.explanation_text && (
          <div
            className="rounded-xl p-4 space-y-1"
            style={{ background: "#15120E", border: "1px solid rgba(237,230,214,0.06)" }}
          >
            <div className="text-[11px] font-mono uppercase tracking-wider font-semibold" style={{ color: "#A69A85" }}>
              Decision Narrative
            </div>
            <p className="text-xs leading-relaxed font-sans" style={{ color: "#EDE6D6" }}>
              {audit.explanation_text}
            </p>
          </div>
        )}

        <div
          className="text-[11px] font-mono flex flex-wrap gap-x-6 gap-y-1 pt-3"
          style={{ borderTop: "1px solid rgba(237,230,214,0.08)", color: "#A69A85" }}
        >
          <span>Auto-Accept Threshold: <strong style={{ color: "#EDE6D6" }}>{audit.threshold_snapshot?.auto_accept ?? "—"}</strong></span>
          <span>Review Threshold: <strong style={{ color: "#EDE6D6" }}>{audit.threshold_snapshot?.review ?? "—"}</strong></span>
        </div>
      </div>

      {/* Audit Trail Timeline */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: "#EDE6D6" }}>
            Sequential Pipeline Trail
          </h2>
          <span className="text-xs font-mono" style={{ color: "#A69A85" }}>
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
    bg: "rgba(37, 30, 22, 0.8)",
    text: "#A69A85",
    border: "rgba(237, 230, 214, 0.1)",
  };

  return (
    <div
      className="glass-panel rounded-2xl p-5 shadow space-y-3 transition-colors"
      style={{ border: "1px solid rgba(237,230,214,0.08)" }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono w-5 text-right font-bold" style={{ color: "#A69A85" }}>
            {step}
          </span>
          <span
            className="text-xs font-mono px-3 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
          >
            {style.label}
          </span>
          {entry.score_delta != null && (
            <span
              className="text-xs font-mono font-bold tabular-nums"
              style={{ color: entry.score_delta >= 0 ? "#7AAE88" : "#C06050" }}
            >
              {entry.score_delta >= 0 ? "+" : ""}
              {entry.score_delta.toFixed(1)} pts
            </span>
          )}
          {entry.score_after != null && (
            <span className="text-xs font-mono tabular-nums" style={{ color: "#B4875A" }}>
              → Score: {entry.score_after.toFixed(1)}
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono" style={{ color: "#A69A85" }}>
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {entry.reasoning_text && (
        <p className="text-xs pl-8 leading-relaxed font-sans" style={{ color: "#EDE6D6" }}>
          {entry.reasoning_text}
        </p>
      )}

      {/* LLM-Specific Section */}
      {entry.pass_name.startsWith("pass5_llm") && (
        <div className="pl-8 space-y-2 pt-1">
          <div className="flex items-center gap-2 text-xs font-mono">
            <Bot className="w-3.5 h-3.5" style={{ color: "#7AAE88" }} />
            <span className="font-semibold" style={{ color: "#EDE6D6" }}>
              {entry.llm_provider === "groq" ? "Groq Llama 3.3 (Fallback Circuit)" : "Gemini 2.5 Flash-Lite"}
            </span>
            {entry.llm_model && <span style={{ color: "#A69A85" }}>· {entry.llm_model}</span>}
            {entry.llm_fallback_used && <span style={{ color: "#C79A45" }}>· Fallback Active</span>}
            {entry.llm_both_failed && <span style={{ color: "#C06050" }}>· Both Failed</span>}
          </div>

          {entry.raw_llm_response && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs font-mono underline cursor-pointer transition-colors"
                style={{ color: "#B4875A" }}
              >
                {expanded ? "▲ Collapse raw LLM payload" : "▼ Inspect raw LLM JSON response"}
              </button>
              {expanded && (
                <pre
                  className="mt-2 rounded-xl p-4 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-normal"
                  style={{
                    background: "#15120E",
                    border: "1px solid rgba(180,135,90,0.22)",
                    color: "#EDE6D6",
                  }}
                >
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
      <div
        className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--accent-camel) transparent transparent transparent" }}
      />
      <span className="text-xs font-mono" style={{ color: "var(--ink-muted)" }}>
        Loading Forensic Audit Trail…
      </span>
    </div>
  );
}
