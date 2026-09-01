"use client";
// app/batches/[batchId]/run/page.tsx — Modern FinTech Live Streaming Telemetry Feed

import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Terminal,
  Zap,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";

interface SseRecord {
  idx: number;
  total: number;
  txn_id: string;
  amount: string;
  band: string;   // "auto_accept" | "review" | "reject" | "exception"
  score: number;
  match_type: string;
  invoices?: string[];
  explanation?: string;
}

interface DoneEvent {
  done: true;
  auto_accept: number;
  review: number;
  exceptions: number;
  total: number;
}

const BAND_CONFIG: Record<string, { label: string; pillClass: string; icon: React.ReactNode }> = {
  auto_accept: {
    label: "Matched",
    pillClass: "band-auto",
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  },
  review: {
    label: "Review",
    pillClass: "band-review",
    icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
  },
  reject: {
    label: "Exception",
    pillClass: "band-reject",
    icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
  },
  exception: {
    label: "Exception",
    pillClass: "band-reject",
    icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
  },
  // Fallback for any unexpected band value
  _unknown: {
    label: "Unknown",
    pillClass: "band-reject",
    icon: <XCircle className="w-3.5 h-3.5 text-slate-400" />,
  },
} as const;

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function RunPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") ?? "";

  const [records, setRecords] = useState<SseRecord[]>([]);
  const [done, setDone] = useState<DoneEvent | null>(null);
  const [status, setStatus] = useState<"connecting" | "streaming" | "completed" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`${BASE}/api/batches/${batchId}/run/${runId}/stream`);

    es.onopen = () => {
      setStatus("streaming");
    };

    es.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.done) {
        if (data.error) {
          setErrorMsg(data.error_message ?? "Reconciliation crashed.");
          setStatus("error");
        } else {
          setDone(data as DoneEvent);
          setStatus("completed");
        }
        es.close();
      } else {
        setRecords((prev) => [...prev, data as SseRecord]);
      }
    };

    es.onerror = () => {
      setStatus((prev) => {
        // If we never got any messages, the queue likely doesn't exist (stale runId)
        if (prev === "connecting") setErrorMsg("Could not connect to run stream. The run may have already completed or crashed before this page loaded.");
        return "error";
      });
      es.close();
    };

    return () => es.close();
  }, [batchId, runId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [records.length]);

  const total = done?.total ?? records.at(-1)?.total ?? records.length;
  const current = records.length;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  // Single source of truth: compute counts directly from the actual per-record stream entries
  const autoAcceptCount = records.filter((r) => r.band === "auto_accept").length;
  const reviewCount = records.filter((r) => r.band === "review").length;
  const exceptionCount = records.filter((r) => r.band === "reject" || r.band === "exception").length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono text-emerald-400">
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            <span>Live Telemetry Engine</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Real-Time Pipeline Execution</h1>
          <p className="text-slate-400 text-xs font-mono">
            Batch: <span className="text-slate-200 font-bold">{batchId}</span> · Run: <span className="text-emerald-400 font-bold">{runId}</span>
          </p>
        </div>

        {done && (
          <Link
            href={`/batches/${batchId}/results?runId=${runId}`}
            className="btn-primary-glow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 self-start sm:self-auto shadow-lg"
          >
            <span>Review Audited Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      {/* Progress & Live Telemetry Card */}
      <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4 shadow-xl">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-slate-300 flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                status === "streaming"
                  ? "bg-emerald-400 animate-ping"
                  : status === "completed"
                  ? "bg-emerald-400"
                  : status === "error"
                  ? "bg-rose-500"
                  : "bg-amber-400"
              }`}
            />
            {status === "completed"
              ? "Reconciliation Finished"
              : status === "streaming"
              ? "Evaluating Passes 1–5 in Parallel…"
              : status === "error"
              ? "Run Failed"
              : "Connecting to Streaming Engine…"}
          </span>
          <span className="text-slate-100 font-bold font-mono">
            {current} / {total || "?"} Records Processed ({pct}%)
          </span>
        </div>

        {/* High-Tech Glowing Progress Bar */}
        <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden p-0.5 border border-white/10">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              status === "error"
                ? "bg-gradient-to-r from-rose-600 to-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.5)]"
                : "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
            }`}
            style={{ width: `${done || status === "error" ? 100 : pct}%` }}
          />
        </div>

        {records.length > 0 && (
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/[0.08] text-center">
            <StatCard label="Auto-Accepted" value={autoAcceptCount} color="text-emerald-400" />
            <StatCard label="Review Queue" value={reviewCount} color="text-amber-400" />
            <StatCard label="Exceptions" value={exceptionCount} color="text-rose-400" />
          </div>
        )}

        {status === "error" && errorMsg && (
          <div className="flex items-start gap-3 mt-4 pt-4 border-t border-rose-500/20 text-xs font-mono">
            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-rose-400 font-semibold">Run crashed — no records were processed</p>
              <p className="text-slate-400 leading-relaxed">{errorMsg}</p>
              <p className="text-slate-500">The Decimal128 fix has been applied. Start a new run to reprocess this batch.</p>
            </div>
          </div>
        )}
      </div>

      {/* Streaming Record Terminal Feed */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
        <div className="px-5 py-3 border-b border-white/[0.08] flex justify-between items-center text-xs font-mono text-slate-400 bg-slate-950/70">
          <span className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>Streaming Output Log</span>
          </span>
          <span className="text-cyan-400 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" /> Fellegi-Sunter + Hungarian Scored
          </span>
        </div>

        {/* Table Column Headers */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] font-mono text-slate-400 border-b border-white/5 bg-[#080d1a] select-none font-semibold">
          <span className="col-span-1 text-center">#</span>
          <span className="col-span-3">Transaction</span>
          <span className="col-span-2 text-right">Amount</span>
          <span className="col-span-2 text-center">Status</span>
          <span className="col-span-1 text-right">Score</span>
          <span className="col-span-3">Matched Invoice(s)</span>
        </div>

        <div className="h-[520px] overflow-y-auto font-mono text-xs p-3 space-y-2 bg-[#06090F]/90">
          {records.map((r) => {
            const config = BAND_CONFIG[r.band] ?? BAND_CONFIG["_unknown"];
            const rowKey = `${r.txn_id}-${r.idx}`;
            const isExpanded = !!expandedRows[rowKey];
            const hasInvoices = r.invoices && r.invoices.length > 0;

            return (
              <div
                key={rowKey}
                className="border border-white/5 hover:border-white/15 rounded-lg overflow-hidden bg-slate-900/40 transition-all duration-150"
              >
                {/* Main Interactive Row */}
                <div
                  onClick={() => toggleRow(rowKey)}
                  className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 hover:bg-slate-800/50 cursor-pointer select-none text-xs"
                >
                  <span className="col-span-1 text-slate-500 text-center flex items-center justify-center gap-1">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>{r.idx}</span>
                  </span>

                  <div className="col-span-3 flex items-center gap-2 min-w-0">
                    <span className="shrink-0">{config.icon}</span>
                    <span className="text-slate-200 font-medium truncate font-mono">{r.txn_id}</span>
                  </div>

                  <span className="col-span-2 text-emerald-400 text-right font-bold font-mono tabular-nums">
                    ₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>

                  <div className="col-span-2 flex justify-center">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-center ${config.pillClass}`}>
                      {config.label}
                    </span>
                  </div>

                  <span className="col-span-1 text-[var(--arctic)] text-right font-mono font-bold tabular-nums">
                    {(r.score ?? 0).toFixed(1)}
                  </span>

                  <div className="col-span-3 flex items-center gap-1.5 truncate">
                    {hasInvoices ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-[11px] font-semibold truncate max-w-full">
                        <FileText className="w-3 h-3 shrink-0 text-cyan-400" />
                        <span className="truncate">{r.invoices!.join(" + ")}</span>
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[11px] font-mono italic">— Unlinked</span>
                    )}
                  </div>
                </div>

                {/* Expandable Explanation & Forensics Drawer */}
                {isExpanded && (
                  <div className="px-4 py-3 bg-[#030712]/95 border-t border-white/5 space-y-2.5 text-xs font-mono">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-slate-400">Match Type:</span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold border border-white/10">
                        {r.match_type}
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className="text-slate-400">Decision Band:</span>
                      <span className="text-slate-300 font-semibold">{config.label}</span>
                      {hasInvoices && (
                        <>
                          <span className="text-slate-600">•</span>
                          <span className="text-slate-400">Target Invoice(s):</span>
                          <span className="text-cyan-400 font-bold">{r.invoices!.join(", ")}</span>
                        </>
                      )}
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-white/10 text-slate-300 text-xs leading-relaxed">
                      <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5 font-semibold flex items-center gap-1.5">
                        <Terminal className="w-3 h-3 text-emerald-400" />
                        Engine Explanation & Audit Reasoning
                      </p>
                      {r.explanation || "No explanation provided for this transaction."}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {!done && status === "streaming" && (
            <div className="text-emerald-400 animate-pulse px-3 py-2 text-xs flex items-center gap-2 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Awaiting next batch record stream…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className={`font-mono text-3xl font-extrabold ${color} tabular-nums`}>{value}</div>
      <div className="text-slate-400 text-xs font-mono">{label}</div>
    </div>
  );
}
