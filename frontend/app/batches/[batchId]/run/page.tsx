"use client";
// app/batches/[batchId]/run/page.tsx — Modern FinTech Live Streaming Telemetry Feed

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Activity, CheckCircle2, AlertTriangle, XCircle, ArrowRight, Terminal, Zap } from "lucide-react";

interface SseRecord {
  idx: number;
  total: number;
  txn_id: string;
  amount: string;
  band: "auto_accept" | "review" | "reject";
  score: number;
  match_type: string;
}

interface DoneEvent {
  done: true;
  auto_accept: number;
  review: number;
  exceptions: number;
  total: number;
}

const BAND_CONFIG = {
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
} as const;

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function RunPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") ?? "";

  const [records, setRecords] = useState<SseRecord[]>([]);
  const [done, setDone] = useState<DoneEvent | null>(null);
  const [status, setStatus] = useState<"connecting" | "streaming" | "completed">("connecting");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`${BASE}/api/batches/${batchId}/run/${runId}/stream`);

    es.onopen = () => {
      setStatus("streaming");
    };

    es.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.done) {
        setDone(data as DoneEvent);
        setStatus("completed");
        es.close();
      } else {
        setRecords((prev) => [...prev, data as SseRecord]);
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [batchId, runId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [records.length]);

  const total = done?.total ?? records.at(-1)?.total ?? 0;
  const current = records.length;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-2">
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
                  : "bg-amber-400"
              }`}
            />
            {status === "completed"
              ? "Reconciliation Finished"
              : status === "streaming"
              ? "Evaluating Passes 1–5 in Parallel…"
              : "Connecting to Streaming Engine…"}
          </span>
          <span className="text-slate-100 font-bold font-mono">
            {current} / {total || "?"} Records Processed ({pct}%)
          </span>
        </div>

        {/* High-Tech Glowing Progress Bar */}
        <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden p-0.5 border border-white/10">
          <div
            className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 h-full rounded-full transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
            style={{ width: `${done ? 100 : pct}%` }}
          />
        </div>

        {done && (
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/[0.08] text-center">
            <StatCard label="Auto-Accepted" value={done.auto_accept} color="text-emerald-400" />
            <StatCard label="Review Queue" value={done.review} color="text-amber-400" />
            <StatCard label="Exceptions" value={done.exceptions} color="text-rose-400" />
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

        <div className="h-[480px] overflow-y-auto font-mono text-xs p-3 space-y-1.5 bg-[#06090F]/90">
          {records.map((r) => {
            const config = BAND_CONFIG[r.band];
            return (
              <div
                key={r.txn_id + r.idx}
                className="flex items-center gap-3 hover:bg-slate-800/40 px-3 py-2 rounded-lg transition-colors border border-transparent hover:border-white/5"
              >
                <span className="text-slate-500 w-6 text-right shrink-0">{r.idx}</span>
                <span className="shrink-0">{config.icon}</span>
                <span className="text-slate-200 shrink-0 w-36 truncate font-medium">{r.txn_id}</span>
                <span className="text-emerald-400 shrink-0 w-28 text-right font-bold tabular-nums">
                  ₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold shrink-0 w-24 text-center ${config.pillClass}`}>
                  {config.label}
                </span>
                <span className="text-[var(--arctic)] shrink-0 w-16 text-right font-mono font-bold tabular-nums">
                  {r.score.toFixed(1)}
                </span>
                <span className="text-slate-400 truncate text-[11px]">{r.match_type}</span>
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
