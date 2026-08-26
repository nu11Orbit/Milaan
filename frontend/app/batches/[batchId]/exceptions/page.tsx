"use client";
// app/batches/[batchId]/exceptions/page.tsx — Exception review queue

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getExceptions, submitReview, type Exception } from "@/lib/api";

const REASON_LABEL: Record<string, string> = {
  no_candidate_found:      "No candidate found",
  noise_below_floor:       "Noise (< ₹10)",
  duplicate_detected:      "Duplicate transaction",
  partial_payment_open:    "Partial payment — open balance",
  orphan_bank_credit:      "Orphan bank credit",
  counterparty_mismatch:   "Counterparty mismatch",
};

export default function ExceptionsPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const runId = useSearchParams().get("runId") ?? undefined;

  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading]       = useState(true);
  const [reviewed, setReviewed]     = useState<Record<string, string>>({});

  useEffect(() => {
    getExceptions(batchId, runId)
      .then(r => setExceptions(r.exceptions))
      .finally(() => setLoading(false));
  }, [batchId, runId]);

  async function handleReview(matchId: string, action: "accepted" | "rejected") {
    await submitReview(matchId, action, "demo-reviewer");
    setReviewed(prev => ({ ...prev, [matchId]: action }));
  }

  if (loading) return <p className="text-slate-400 animate-pulse">Loading exceptions…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Exception Queue</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          {exceptions.length} unreconciled records — each has a structured reason code.
        </p>
      </div>

      {exceptions.length === 0 && (
        <div className="text-slate-500 text-sm bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center">
          No exceptions — all records reconciled ✅
        </div>
      )}

      <div className="space-y-3">
        {exceptions.map((ex) => {
          const decision = reviewed[ex.match_id];
          return (
            <div key={ex.match_id}
                 className="bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-red-400 text-xs font-mono">{ex.match_id}</span>
                    <span className="bg-red-900/40 text-red-300 border border-red-700/50 text-xs px-2 py-0.5 rounded-full">
                      {REASON_LABEL[ex.exception_reason_category ?? ""] ?? ex.exception_reason_category ?? "unknown"}
                    </span>
                  </div>
                  {ex.exception_reason_detail && (
                    <p className="text-slate-400 text-xs">{ex.exception_reason_detail}</p>
                  )}
                  <div className="flex gap-3 text-xs text-slate-600 mt-1">
                    {ex.line_items.map((li, i) => (
                      <span key={i}>
                        {li.txn_id && <span>Txn: <code className="text-slate-400">{li.txn_id}</code></span>}
                        {li.invoice_id && <span> · Inv: <code className="text-slate-400">{li.invoice_id}</code></span>}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Review actions */}
                {decision ? (
                  <span className={`text-sm font-medium shrink-0 ${decision === "accepted" ? "text-green-400" : "text-red-400"}`}>
                    {decision === "accepted" ? "✓ Accepted" : "✗ Rejected"}
                  </span>
                ) : (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleReview(ex.match_id, "accepted")}
                            className="text-xs bg-green-900/40 hover:bg-green-900/70 text-green-300 border border-green-700/50 px-3 py-1.5 rounded-lg transition-colors">
                      Accept
                    </button>
                    <button onClick={() => handleReview(ex.match_id, "rejected")}
                            className="text-xs bg-red-900/40 hover:bg-red-900/70 text-red-300 border border-red-700/50 px-3 py-1.5 rounded-lg transition-colors">
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
