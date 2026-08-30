"use client";
// app/batches/[batchId]/exceptions/page.tsx — Modern FinTech Exception Triage Desk

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getExceptions, submitReview, type Exception } from "@/lib/api";
import { ArrowLeft, CheckCircle2, ShieldAlert, Check, X } from "lucide-react";

const REASON_LABEL: Record<string, string> = {
  no_candidate_found: "No candidate found",
  noise_below_floor: "Noise (< ₹10)",
  duplicate_detected: "Duplicate transaction",
  partial_payment_open: "Partial payment — open balance",
  orphan_bank_credit: "Orphan bank credit",
  counterparty_mismatch: "Counterparty mismatch",
};

export default function ExceptionsPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const runId = useSearchParams().get("runId") ?? undefined;

  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState<Record<string, string>>({});

  useEffect(() => {
    getExceptions(batchId, runId)
      .then((r) => setExceptions(r.exceptions))
      .finally(() => setLoading(false));
  }, [batchId, runId]);

  async function handleReview(matchId: string, action: "accepted" | "rejected") {
    await submitReview(matchId, action, "milaan-controller");
    setReviewed((prev) => ({ ...prev, [matchId]: action }));
  }

  if (loading) return <Loading />;

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-2">
      {/* Back Link & Header */}
      <div className="space-y-2">
        <Link
          href={`/batches/${batchId}/results${runId ? `?runId=${runId}` : ""}`}
          className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-400 hover:text-emerald-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Ledger Results</span>
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-mono text-rose-400">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Exception Triage Desk</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight mt-1">Unreconciled Records</h1>
            <p className="text-slate-400 text-xs font-mono mt-0.5">
              {exceptions.length} unreconciled item{exceptions.length === 1 ? "" : "s"} requiring manual controller adjudication
            </p>
          </div>
        </div>
      </div>

      {exceptions.length === 0 && (
        <div className="glass-panel rounded-2xl p-12 text-center space-y-3 border border-emerald-500/30">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Clean Ledger: Zero Exceptions</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            All records in this batch were successfully reconciled or resolved by the 5-pass engine.
          </p>
        </div>
      )}

      <div className="space-y-3.5">
        {exceptions.map((ex) => {
          const decision = reviewed[ex.match_id];
          return (
            <div
              key={ex.match_id}
              className="glass-panel rounded-2xl p-5 shadow space-y-3 border border-white/[0.08] hover:border-emerald-500/30 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-slate-100 font-bold">{ex.match_id}</span>
                    <span className="band-reject px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold">
                      {REASON_LABEL[ex.exception_reason_category ?? ""] ?? ex.exception_reason_category ?? "Unknown Exception"}
                    </span>
                  </div>

                  {ex.exception_reason_detail && (
                    <p className="text-xs text-slate-300 leading-relaxed font-sans">{ex.exception_reason_detail}</p>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400 pt-1">
                    {ex.line_items.map((li, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        {li.txn_id && (
                          <span>
                            Txn: <strong className="text-slate-200">{li.txn_id}</strong>
                          </span>
                        )}
                        {li.invoice_id && (
                          <span>
                            · Inv: <strong className="text-[var(--arctic)]">{li.invoice_id}</strong>
                          </span>
                        )}
                        {li.allocated_amount && (
                          <span>
                            · Amount: <strong className="text-emerald-400">₹{Number(li.allocated_amount).toLocaleString("en-IN")}</strong>
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Controller Action Buttons */}
                {decision ? (
                  <span
                    className={`text-xs font-mono font-bold px-3.5 py-1.5 rounded-xl shrink-0 ${
                      decision === "accepted" ? "band-auto" : "band-reject"
                    }`}
                  >
                    {decision === "accepted" ? "✓ Approved by Controller" : "✗ Rejected to Suspense"}
                  </span>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleReview(ex.match_id, "accepted")}
                      className="text-xs font-mono font-bold px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Accept</span>
                    </button>
                    <button
                      onClick={() => handleReview(ex.match_id, "rejected")}
                      className="text-xs font-mono font-bold px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
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

function Loading() {
  return (
    <div className="h-64 flex items-center justify-center space-y-2 flex-col">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      <span className="text-xs font-mono text-slate-400">Loading Exception Triage Queue…</span>
    </div>
  );
}
