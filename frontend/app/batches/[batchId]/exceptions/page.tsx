"use client";
// app/batches/[batchId]/exceptions/page.tsx — Exception Triage Desk

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getExceptions, submitReview, type Exception } from "@/lib/api";
import { ArrowLeft, CheckCircle2, ShieldAlert, Check, X, ExternalLink } from "lucide-react";

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
  const [filter, setFilter] = useState<string>("all");

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

  const filtered = exceptions.filter((ex) => {
    if (filter === "pending") return !reviewed[ex.match_id];
    if (filter === "reviewed") return !!reviewed[ex.match_id];
    return true;
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto pt-28 pb-16 px-4">
      {/* Back Link & Header */}
      <div className="space-y-2">
        <Link
          href={`/batches/${batchId}/results${runId ? `?runId=${runId}` : ""}`}
          className="inline-flex items-center gap-1.5 text-xs font-mono transition-colors hover:underline"
          style={{ color: "#A69A85" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Ledger Results</span>
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div
              className="inline-flex items-center gap-1.5 text-xs font-mono"
              style={{ color: "#C06050" }}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Exception Triage Desk</span>
            </div>
            <h1
              className="text-3xl font-extrabold tracking-tight mt-1"
              style={{ color: "#EDE6D6", fontFamily: "var(--font-display)" }}
            >
              Unreconciled Records
            </h1>
            <p className="text-xs font-mono mt-0.5" style={{ color: "#A69A85" }}>
              {exceptions.length} unreconciled item{exceptions.length === 1 ? "" : "s"} requiring manual controller adjudication
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 text-xs font-mono">
            {[
              { id: "all", label: `All (${exceptions.length})` },
              { id: "pending", label: `Pending (${exceptions.filter(e => !reviewed[e.match_id]).length})` },
              { id: "reviewed", label: `Adjudicated (${Object.keys(reviewed).length})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className="px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                style={
                  filter === f.id
                    ? { background: "#251E16", color: "#B4875A", border: "1px solid rgba(180,135,90,0.35)", fontWeight: "bold" }
                    : { background: "rgba(237,230,214,0.04)", color: "#A69A85", border: "1px solid rgba(237,230,214,0.08)" }
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {exceptions.length === 0 && (
        <div
          className="glass-panel rounded-2xl p-12 text-center space-y-3"
          style={{ border: "1px solid rgba(60,107,76,0.35)" }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
            style={{ background: "rgba(60,107,76,0.15)", border: "1px solid rgba(60,107,76,0.4)", color: "#7AAE88" }}
          >
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold" style={{ color: "#EDE6D6" }}>Clean Ledger: Zero Exceptions</h3>
          <p className="text-xs max-w-sm mx-auto" style={{ color: "#A69A85" }}>
            All records in this batch were successfully reconciled or resolved by the 5-pass engine.
          </p>
        </div>
      )}

      <div className="space-y-3.5">
        {filtered.map((ex) => {
          const decision = reviewed[ex.match_id];
          return (
            <div
              key={ex.match_id}
              className="glass-panel rounded-2xl p-5 shadow space-y-3 transition-colors"
              style={{ border: "1px solid rgba(237,230,214,0.08)" }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold" style={{ color: "#EDE6D6" }}>
                      {ex.match_id}
                    </span>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold"
                      style={{
                        background: "rgba(163,76,63,0.15)",
                        color: "#C06050",
                        border: "1px solid rgba(163,76,63,0.35)",
                      }}
                    >
                      {REASON_LABEL[ex.exception_reason_category ?? ""] ?? ex.exception_reason_category ?? "Unresolved Exception"}
                    </span>
                  </div>

                  {ex.exception_reason_detail && (
                    <p className="text-xs leading-relaxed font-sans" style={{ color: "#EDE6D6" }}>
                      {ex.exception_reason_detail}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono pt-1" style={{ color: "#A69A85" }}>
                    {ex.line_items.map((li, i) => (
                      <span key={`${ex.match_id}-item-${i}`} className="flex items-center gap-1.5">
                        {li.txn_id && (
                          <span>
                            Txn: <strong style={{ color: "#EDE6D6" }}>{li.txn_id}</strong>
                          </span>
                        )}
                        {li.invoice_id && (
                          <span className="flex items-center gap-1">
                            · Inv:{" "}
                            <span
                              className="px-1.5 py-0.2 rounded text-[10px]"
                              style={{
                                background: "#251E16",
                                border: "1px solid rgba(180,135,90,0.3)",
                                color: "#B4875A",
                              }}
                            >
                              {li.invoice_id}
                            </span>
                          </span>
                        )}
                        {li.allocated_amount && (
                          <span>
                            · Amount: <strong style={{ color: "#7AAE88" }}>₹{Number(li.allocated_amount).toLocaleString("en-IN")}</strong>
                          </span>
                        )}
                      </span>
                    ))}
                  </div>

                  <div className="pt-1">
                    <Link
                      href={`/batches/${batchId}/matches/${ex.match_id}`}
                      className="inline-flex items-center gap-1 text-[11px] font-mono hover:underline"
                      style={{ color: "#B4875A" }}
                    >
                      <span>Inspect Audit Decision Trail</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </div>

                {/* Controller Action Buttons */}
                {decision ? (
                  <span
                    className="text-xs font-mono font-bold px-3.5 py-1.5 rounded-xl shrink-0"
                    style={
                      decision === "accepted"
                        ? { background: "rgba(60,107,76,0.18)", color: "#7AAE88", border: "1px solid rgba(60,107,76,0.4)" }
                        : { background: "rgba(163,76,63,0.18)", color: "#C06050", border: "1px solid rgba(163,76,63,0.4)" }
                    }
                  >
                    {decision === "accepted" ? "✓ Approved by Controller" : "✗ Rejected to Suspense"}
                  </span>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleReview(ex.match_id, "accepted")}
                      className="text-xs font-mono font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1 cursor-pointer hover:opacity-90"
                      style={{
                        background: "rgba(60,107,76,0.18)",
                        color: "#7AAE88",
                        border: "1px solid rgba(60,107,76,0.4)",
                      }}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Accept</span>
                    </button>
                    <button
                      onClick={() => handleReview(ex.match_id, "rejected")}
                      className="text-xs font-mono font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1 cursor-pointer hover:opacity-90"
                      style={{
                        background: "rgba(163,76,63,0.18)",
                        color: "#C06050",
                        border: "1px solid rgba(163,76,63,0.4)",
                      }}
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
      <div
        className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--accent-camel) transparent transparent transparent" }}
      />
      <span className="text-xs font-mono" style={{ color: "var(--ink-muted)" }}>
        Loading Exception Triage Queue…
      </span>
    </div>
  );
}
