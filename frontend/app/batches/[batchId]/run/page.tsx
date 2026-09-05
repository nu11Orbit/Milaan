"use client";
// app/batches/[batchId]/run/page.tsx — Live Streaming Telemetry Feed

import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getMatches, API_BASE_URL } from "@/lib/api";
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
  ExternalLink,
} from "lucide-react";

interface SseRecord {
  idx: number;
  total: number;
  match_id?: string;
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
    icon: <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--signal-match)" }} />,
  },
  review: {
    label: "Review",
    pillClass: "band-review",
    icon: <AlertTriangle className="w-3.5 h-3.5" style={{ color: "var(--signal-review)" }} />,
  },
  reject: {
    label: "Exception",
    pillClass: "band-reject",
    icon: <XCircle className="w-3.5 h-3.5" style={{ color: "var(--signal-exception)" }} />,
  },
  exception: {
    label: "Exception",
    pillClass: "band-reject",
    icon: <XCircle className="w-3.5 h-3.5" style={{ color: "var(--signal-exception)" }} />,
  },
  _unknown: {
    label: "Unknown",
    pillClass: "band-reject",
    icon: <XCircle className="w-3.5 h-3.5" style={{ color: "var(--ink-muted)" }} />,
  },
} as const;

const BASE = API_BASE_URL;

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
    if (!batchId || batchId === "sample") {
      setStatus("error");
      setErrorMsg("Invalid or missing batch identifier. Please start a new reconciliation intake.");
      return;
    }

    if (!runId) {
      // Fallback: check if the batch has existing persisted matches
      getMatches(batchId)
        .then((res) => {
          if (res.matches && res.matches.length > 0) {
            const mapped: SseRecord[] = res.matches.map((m, i) => ({
              idx: i + 1,
              total: res.matches.length,
              match_id: m.match_id,
              txn_id: m.line_items.find((li) => li.txn_id)?.txn_id ?? `TXN-${i + 1}`,
              amount: m.line_items.reduce((s, li) => s + (Number(li.allocated_amount) || 0), 0).toFixed(2),
              band: m.confidence_band,
              score: m.confidence_score,
              match_type: m.match_type,
              invoices: m.line_items.filter((li) => li.invoice_id).map((li) => li.invoice_id!),
              explanation: m.explanation_text ?? undefined,
            }));
            setRecords(mapped);
            setStatus("completed");
            setDone({
              done: true,
              auto_accept: mapped.filter((r) => r.band === "auto_accept").length,
              review: mapped.filter((r) => r.band === "review").length,
              exceptions: mapped.filter((r) => r.band === "reject" || r.band === "exception").length,
              total: mapped.length,
            });
          } else {
            setStatus("error");
            setErrorMsg("No active Run ID specified. Please launch a run from the intake screen.");
          }
        })
        .catch(() => {
          setStatus("error");
          setErrorMsg("No active Run ID specified. Please launch a run from the intake screen.");
        });
      return;
    }

    // Always keep the header "Last Run" link pointing at this run
    try {
      localStorage.setItem("milaan_last_run", JSON.stringify({ batchId, runId }));
    } catch { /* ignore */ }

    let es: EventSource | null = null;
    let isCancelled = false;

    // 1. Immediately initiate SSE stream connection without blocking on getMatches
    connectSse();

    // 2. Concurrently check if run already finished, and poll every 3s as a robust fallback
    const pollMatches = () => {
      getMatches(batchId, runId)
        .then((res) => {
          if (isCancelled) return;
          if (res.matches && res.matches.length > 0) {
            const mapped: SseRecord[] = res.matches.map((m, i) => ({
              idx: i + 1,
              total: res.matches.length,
              match_id: m.match_id,
              txn_id: m.line_items.find((li) => li.txn_id)?.txn_id ?? `TXN-${i + 1}`,
              amount: m.line_items.reduce((s, li) => s + (Number(li.allocated_amount) || 0), 0).toFixed(2),
              band: m.confidence_band,
              score: m.confidence_score,
              match_type: m.match_type,
              invoices: m.line_items.filter((li) => li.invoice_id).map((li) => li.invoice_id!),
              explanation: m.explanation_text ?? undefined,
            }));
            setRecords(mapped);
            setStatus("completed");
            setDone({
              done: true,
              auto_accept: mapped.filter((r) => r.band === "auto_accept").length,
              review: mapped.filter((r) => r.band === "review").length,
              exceptions: mapped.filter((r) => r.band === "reject" || r.band === "exception").length,
              total: mapped.length,
            });
            clearInterval(pollInterval);
            es?.close();
          }
        })
        .catch(() => {});
    };

    // Run initial check and start 3s poll interval
    pollMatches();
    const pollInterval = setInterval(pollMatches, 3000);

    function connectSse() {
      try {
        es = new EventSource(`${BASE}/api/batches/${batchId}/run/${runId}/stream`);

        es.onopen = () => {
          if (!isCancelled) setStatus("streaming");
        };

        es.onmessage = (evt) => {
          if (isCancelled) return;
          try {
            const data = JSON.parse(evt.data);

            if (data.status === "connected") {
              setStatus("streaming");
              return;
            }

            if (data.error) {
              pollMatches();
              es?.close();
              return;
            }

            if (data.done) {
              setDone(data as DoneEvent);
              setStatus("completed");
              clearInterval(pollInterval);
              es?.close();
              return;
            }

            if (data.txn_id) {
              setStatus("streaming");
              setRecords((prev) => {
                // Deduplicate by match_id or txn_id
                if (prev.some((r) => r.match_id === data.match_id || (r.txn_id === data.txn_id && r.idx === data.idx))) {
                  return prev;
                }
                return [...prev, data as SseRecord];
              });
            }
          } catch { /* ignore malformed lines / comments */ }
        };

        es.onerror = () => {
          // If SSE connection disconnects, poll DB directly
          pollMatches();
        };
      } catch (err) {
        pollMatches();
      }
    }

    return () => {
      isCancelled = true;
      clearInterval(pollInterval);
      es?.close();
    };
  }, [batchId, runId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [records.length]);

  const total = done?.total ?? records.at(-1)?.total ?? records.length;
  const current = records.length;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  const autoAcceptCount = records.filter((r) => r.band === "auto_accept").length;
  const reviewCount = records.filter((r) => r.band === "review").length;
  const exceptionCount = records.filter((r) => r.band === "reject" || r.band === "exception").length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pt-28 pb-16 px-4">
      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono"
            style={{
              background: "rgba(60,107,76,0.12)",
              border: "1px solid rgba(60,107,76,0.35)",
              color: "var(--signal-match)",
            }}
          >
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            <span>Live Telemetry Engine</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--ink-primary)", fontFamily: "var(--font-display)" }}>
            Real-Time Pipeline Execution
          </h1>
          <p className="text-xs font-mono" style={{ color: "var(--ink-muted)" }}>
            Batch: <span className="font-bold" style={{ color: "var(--ink-primary)" }}>{batchId}</span>
            {" · "}Run: <span className="font-bold" style={{ color: "var(--accent-camel)" }}>{runId}</span>
          </p>
        </div>

        {runId && (
          <Link
            href={`/batches/${batchId}/results?runId=${runId}`}
            className={`flex items-center gap-2 rounded-xl text-xs font-bold px-5 py-2.5 self-start sm:self-auto transition-all ${
              done || status === "error" || status === "completed"
                ? "btn-primary-glow shadow-lg"
                : "btn-secondary-camel opacity-70 hover:opacity-100"
            }`}
          >
            <span>Review Audited Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      {/* ── PROGRESS & LIVE TELEMETRY CARD ── */}
      <div className="glass-panel rounded-2xl p-6 space-y-4">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="flex items-center gap-2" style={{ color: "var(--ink-muted)" }}>
            <span
              className={status === "streaming" ? "animate-ping" : ""}
              style={{
                display: "inline-block",
                width: "0.625rem",
                height: "0.625rem",
                borderRadius: "9999px",
                backgroundColor:
                  status === "streaming" ? "var(--signal-match)"
                  : status === "completed" ? "var(--signal-match)"
                  : status === "error" ? "var(--signal-exception)"
                  : "var(--signal-review)",
              }}
            />
            {status === "completed"
              ? "Reconciliation Finished"
              : status === "streaming"
              ? "Evaluating Passes 1–5 in Parallel…"
              : status === "error"
              ? "Run Failed"
              : "Connecting to Streaming Engine…"}
          </span>
          <span className="font-bold font-mono" style={{ color: "var(--ink-primary)" }}>
            {current} / {total || "?"} Records Processed ({pct}%)
          </span>
        </div>

        {/* Progress Bar */}
        <div
          className="w-full rounded-full h-3 overflow-hidden p-0.5"
          style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${done || status === "error" ? 100 : pct}%`,
              background:
                status === "error"
                  ? `linear-gradient(to right, var(--signal-exception), #C06050)`
                  : `linear-gradient(to right, var(--accent-forest), var(--accent-camel))`,
              boxShadow:
                status === "error"
                  ? "0 0 12px rgba(163,76,63,0.4)"
                  : "0 0 12px rgba(46,74,56,0.4)",
            }}
          />
        </div>

        {records.length > 0 && (
          <div
            className="grid grid-cols-3 gap-4 pt-4 text-center"
            style={{ borderTop: "1px solid var(--border-hairline)" }}
          >
            <StatCard label="Auto-Accepted" value={autoAcceptCount} tokenColor="var(--signal-match)" />
            <StatCard label="Review Queue" value={reviewCount} tokenColor="var(--signal-review)" />
            <StatCard label="Exceptions" value={exceptionCount} tokenColor="var(--signal-exception)" />
          </div>
        )}

        {status === "error" && errorMsg && (
          <div
            className="flex items-start gap-3 mt-4 pt-4 text-xs font-mono"
            style={{ borderTop: "1px solid rgba(163,76,63,0.2)" }}
          >
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--signal-exception)" }} />
            <div className="space-y-1">
              <p className="font-semibold" style={{ color: "var(--signal-exception)" }}>Run crashed — no records were processed</p>
              <p style={{ color: "var(--ink-muted)" }}>{errorMsg}</p>
              <p style={{ color: "var(--ink-muted)", opacity: 0.7 }}>The Decimal128 fix has been applied. Start a new run to reprocess this batch.</p>
            </div>
          </div>
        )}
      </div>

      {/* ── STREAMING RECORD TERMINAL FEED ── */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        {/* Log Panel Chrome */}
        <div
          className="px-5 py-3 flex justify-between items-center text-xs font-mono"
          style={{
            borderBottom: "1px solid var(--border-hairline)",
            background: "var(--bg-base)",
            color: "var(--ink-muted)",
          }}
        >
          <span className="flex items-center gap-2">
            <Terminal className="w-4 h-4" style={{ color: "var(--accent-camel)" }} />
            <span>Streaming Output Log</span>
          </span>
          <span className="flex items-center gap-1" style={{ color: "var(--ink-muted)" }}>
            <Zap className="w-3.5 h-3.5" style={{ color: "var(--accent-camel)", opacity: 0.7 }} />
            Fellegi-Sunter + Hungarian Scored
          </span>
        </div>

        {/* Table Column Headers */}
        <div
          className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] font-mono font-semibold select-none"
          style={{
            color: "var(--ink-muted)",
            borderBottom: "1px solid var(--border-hairline)",
            background: "var(--bg-base)",
          }}
        >
          <span className="col-span-1 text-center">#</span>
          <span className="col-span-3">Transaction</span>
          <span className="col-span-2 text-right">Amount</span>
          <span className="col-span-2 text-center">Status</span>
          <span className="col-span-1 text-right">Score</span>
          <span className="col-span-3">Matched Invoice(s)</span>
        </div>

        {/* Record Rows */}
        <div
          className="h-[520px] overflow-y-auto font-mono text-xs p-3 space-y-2"
          style={{ background: "var(--bg-base)" }}
        >
          {records.map((r) => {
            const config = BAND_CONFIG[r.band] ?? BAND_CONFIG["_unknown"];
            const rowKey = `${r.txn_id}-${r.idx}`;
            const isExpanded = !!expandedRows[rowKey];
            const hasInvoices = r.invoices && r.invoices.length > 0;

            return (
              <div
                key={rowKey}
                className="rounded-lg overflow-hidden transition-all duration-150"
                style={{
                  border: isExpanded
                    ? "1px solid var(--border-camel)"
                    : "1px solid var(--border-hairline)",
                  background: "var(--bg-surface)",
                }}
              >
                {/* Main Interactive Row */}
                <div
                  onClick={() => toggleRow(rowKey)}
                  className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 cursor-pointer select-none text-xs transition-colors duration-100"
                  style={{ ["--tw-bg-opacity" as string]: 1 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-surface-raised)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <span
                    className="col-span-1 text-center flex items-center justify-center gap-1"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--accent-camel)" }} />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--ink-muted)" }} />
                    )}
                    <span>{r.idx}</span>
                  </span>

                  <div className="col-span-3 flex items-center gap-2 min-w-0">
                    <span className="shrink-0">{config.icon}</span>
                    <span className="font-medium truncate font-mono" style={{ color: "var(--ink-primary)" }}>
                      {r.txn_id}
                    </span>
                  </div>

                  <span
                    className="col-span-2 text-right font-bold font-mono tabular-nums"
                    style={{ color: "var(--accent-camel)" }}
                  >
                    ₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>

                  <div className="col-span-2 flex justify-center">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-center ${config.pillClass}`}>
                      {config.label}
                    </span>
                  </div>

                  <span
                    className="col-span-1 text-right font-mono font-bold tabular-nums"
                    style={{ color: "var(--accent-camel)" }}
                  >
                    {(r.score ?? 0).toFixed(1)}
                  </span>

                  <div className="col-span-3 flex items-center gap-1.5 truncate">
                    {hasInvoices ? (
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded font-mono text-[11px] font-semibold truncate max-w-full"
                        style={{
                          background: "rgba(180,135,90,0.08)",
                          border: "1px solid rgba(180,135,90,0.3)",
                          color: "var(--accent-camel)",
                        }}
                      >
                        <FileText className="w-3 h-3 shrink-0" style={{ color: "var(--accent-camel)", opacity: 0.7 }} />
                        <span className="truncate">{r.invoices!.join(" + ")}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono italic" style={{ color: "var(--ink-muted)" }}>
                        — Unlinked
                      </span>
                    )}
                  </div>
                </div>

                {/* Expandable Explanation & Forensics Drawer */}
                {isExpanded && (
                  <div
                    className="px-4 py-3 space-y-2.5 text-xs font-mono"
                    style={{
                      borderTop: "1px solid var(--border-hairline)",
                      background: "var(--bg-base)",
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span style={{ color: "var(--ink-muted)" }}>Match Type:</span>
                      <span
                        className="px-2 py-0.5 rounded font-semibold"
                        style={{
                          background: "var(--bg-surface-raised)",
                          color: "var(--ink-primary)",
                          border: "1px solid var(--border-hairline)",
                        }}
                      >
                        {r.match_type}
                      </span>
                      <span style={{ color: "var(--border-camel)" }}>•</span>
                      <span style={{ color: "var(--ink-muted)" }}>Decision Band:</span>
                      <span className="font-semibold" style={{ color: "var(--ink-primary)" }}>{config.label}</span>
                      {hasInvoices && (
                        <>
                          <span style={{ color: "var(--border-camel)" }}>•</span>
                          <span style={{ color: "var(--ink-muted)" }}>Target Invoice(s):</span>
                          <span className="font-bold" style={{ color: "var(--accent-camel)" }}>
                            {r.invoices!.join(", ")}
                          </span>
                        </>
                      )}
                    </div>

                    <div
                      className="p-3 rounded-lg text-xs leading-relaxed"
                      style={{
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-hairline)",
                        color: "var(--ink-primary)",
                      }}
                    >
                      <p
                        className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold flex items-center gap-1.5"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        <Terminal className="w-3 h-3" style={{ color: "var(--accent-camel)" }} />
                        Engine Explanation & Audit Reasoning
                      </p>
                      {r.explanation || "No explanation provided for this transaction."}

                      {r.match_id && (
                        <div className="pt-2 mt-2 border-t border-[rgba(237,230,214,0.06)] flex justify-end">
                          <Link
                            href={`/batches/${batchId}/matches/${r.match_id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold transition-all"
                            style={{
                              background: "rgba(180,135,90,0.12)",
                              border: "1px solid rgba(180,135,90,0.3)",
                              color: "var(--accent-camel)",
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLElement).style.background = "rgba(180,135,90,0.22)";
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLElement).style.background = "rgba(180,135,90,0.12)";
                            }}
                          >
                            <span>Inspect Forensic Audit Trail</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {!done && status === "streaming" && (
            <div
              className="animate-pulse px-3 py-2 text-xs flex items-center gap-2 font-mono"
              style={{ color: "var(--signal-match)" }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--signal-match)" }}
              />
              <span>Awaiting next batch record stream…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tokenColor }: { label: string; value: number; tokenColor: string }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-3xl font-extrabold tabular-nums" style={{ color: tokenColor }}>
        {value}
      </div>
      <div className="text-xs font-mono" style={{ color: "var(--ink-muted)" }}>{label}</div>
    </div>
  );
}

