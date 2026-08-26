"use client";
// app/batches/[batchId]/matches/[matchId]/page.tsx — Audit trail + per-pass score

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getAuditTrail, type AuditTrail, type AuditEntry } from "@/lib/api";

const PASS_COLOR: Record<string, string> = {
  pass1_rules:     "bg-blue-900/40 text-blue-300 border-blue-700/50",
  pass2_fuzzy:     "bg-purple-900/40 text-purple-300 border-purple-700/50",
  pass3_embedding: "bg-cyan-900/40 text-cyan-300 border-cyan-700/50",
  pass4_split_matcher: "bg-orange-900/40 text-orange-300 border-orange-700/50",
  pass5_llm:       "bg-pink-900/40 text-pink-300 border-pink-700/50",
  confidence_scorer: "bg-slate-800 text-slate-300 border-slate-700",
  human_review:    "bg-green-900/40 text-green-300 border-green-700/50",
};

export default function MatchDetailPage() {
  const { batchId, matchId } = useParams<{ batchId: string; matchId: string }>();
  const [audit, setAudit] = useState<AuditTrail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditTrail(matchId).then(setAudit).finally(() => setLoading(false));
  }, [matchId]);

  if (loading) return <p className="text-slate-400 animate-pulse">Loading audit trail…</p>;
  if (!audit) return <p className="text-red-400">Audit trail not found.</p>;

  const bandClass = audit.confidence_band === "auto_accept" ? "band-auto"
                  : audit.confidence_band === "review" ? "band-review" : "band-reject";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Match summary */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">{audit.match_id}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{audit.match_type.replace(/_/g, " ")}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-400">{audit.confidence_score.toFixed(1)}</div>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${bandClass}`}>
              {audit.confidence_band.replace("_", " ")}
            </span>
          </div>
        </div>
        {audit.explanation_text && (
          <p className="text-slate-300 text-sm bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            {audit.explanation_text}
          </p>
        )}
        <div className="text-xs text-slate-600 flex gap-4">
          <span>Auto-accept threshold: {audit.threshold_snapshot.auto_accept ?? "—"}</span>
          <span>Review threshold: {audit.threshold_snapshot.review ?? "—"}</span>
        </div>
      </div>

      {/* Audit trail */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Audit Trail — Step by Step</h2>
        {audit.audit_trail.map((entry, i) => (
          <AuditCard key={entry.log_id} entry={entry} step={i + 1} />
        ))}
      </div>
    </div>
  );
}

function AuditCard({ entry, step }: { entry: AuditEntry; step: number }) {
  const [expanded, setExpanded] = useState(false);
  const cls = PASS_COLOR[entry.pass_name] ?? "bg-slate-800 text-slate-300 border-slate-700";

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-slate-600 text-xs w-5 text-right">{step}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>
            {entry.pass_name.replace(/_/g, " ")}
          </span>
          {entry.score_delta != null && (
            <span className={`text-xs font-mono font-bold ${entry.score_delta >= 0 ? "text-green-400" : "text-red-400"}`}>
              {entry.score_delta >= 0 ? "+" : ""}{entry.score_delta.toFixed(1)} pts
            </span>
          )}
          {entry.score_after != null && (
            <span className="text-xs text-slate-500 font-mono">→ {entry.score_after.toFixed(1)}</span>
          )}
        </div>
        <span className="text-slate-700 text-xs">{new Date(entry.timestamp).toLocaleTimeString()}</span>
      </div>

      {entry.reasoning_text && (
        <p className="text-slate-400 text-xs pl-8">{entry.reasoning_text}</p>
      )}

      {/* LLM-specific section */}
      {entry.pass_name === "pass5_llm" && (
        <div className="pl-8 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-pink-400 font-medium">
              {entry.llm_provider === "groq" ? "⚡ Groq Llama (fallback)" : "✨ Gemini 2.5 Flash-Lite"}
            </span>
            {entry.llm_model && <span className="text-slate-600">· {entry.llm_model}</span>}
            {entry.llm_fallback_used && <span className="text-amber-400">· fallback used</span>}
            {entry.llm_both_failed  && <span className="text-red-400">· both providers failed</span>}
          </div>

          {entry.raw_llm_response && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-pink-400 hover:text-pink-300 transition-colors"
              >
                {expanded ? "▲ Hide" : "▼ Show"} raw LLM response
              </button>
              {expanded && (
                <pre className="mt-2 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(entry.raw_llm_response!), null, 2); }
                    catch { return entry.raw_llm_response; }
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
