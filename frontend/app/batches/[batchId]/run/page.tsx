"use client";
// app/batches/[batchId]/run/page.tsx — Live SSE stream view

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

interface SseRecord {
  idx: number; total: number; txn_id: string; amount: string;
  band: "auto_accept" | "review" | "reject"; score: number; match_type: string;
}

interface DoneEvent {
  done: true; auto_accept: number; review: number; exceptions: number; total: number;
}

const BAND_ICON  = { auto_accept: "✅", review: "⚠️", reject: "❌" } as const;
const BAND_COLOR = { auto_accept: "text-green-400", review: "text-amber-400", reject: "text-red-400" } as const;

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function RunPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") ?? "";
  const router = useRouter();

  const [records, setRecords]   = useState<SseRecord[]>([]);
  const [done, setDone]         = useState<DoneEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`${BASE}/api/batches/${batchId}/run/${runId}/stream`);
    setConnected(true);

    es.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.done) {
        setDone(data as DoneEvent);
        es.close();
        setConnected(false);
      } else {
        setRecords(prev => [...prev, data as SseRecord]);
      }
    };
    es.onerror = () => { es.close(); setConnected(false); };
    return () => es.close();
  }, [batchId, runId]);

  // Auto-scroll feed
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [records]);

  const total   = done?.total ?? records.at(-1)?.total ?? 0;
  const current = records.length;
  const pct     = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Reconciliation</h1>
          <p className="text-slate-400 text-sm mt-0.5">Batch: <code className="text-blue-400">{batchId}</code> · Run: <code className="text-blue-400">{runId}</code></p>
        </div>
        {done && (
          <Link
            href={`/batches/${batchId}/results?runId=${runId}`}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            View Results →
          </Link>
        )}
      </div>

      {/* Progress bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">{done ? "Complete" : connected ? "Processing…" : "Connecting…"}</span>
          <span className="text-white font-mono">{current} / {total || "?"}</span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${done ? 100 : pct}%` }}
          />
        </div>
        {done && (
          <div className="grid grid-cols-3 gap-4 pt-2 text-center text-sm">
            <Stat label="Auto-accepted" value={done.auto_accept} color="text-green-400" />
            <Stat label="Review queue"  value={done.review}      color="text-amber-400" />
            <Stat label="Exceptions"    value={done.exceptions}  color="text-red-400" />
          </div>
        )}
      </div>

      {/* Scrolling feed */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800 text-xs text-slate-500 font-medium uppercase tracking-wide">
          Record Feed
        </div>
        <div className="h-[480px] overflow-y-auto font-mono text-xs p-3 space-y-1">
          {records.map((r) => (
            <div key={r.txn_id + r.idx} className="flex items-center gap-3 hover:bg-slate-800/40 px-2 py-0.5 rounded">
              <span className="text-slate-600 w-6 text-right shrink-0">{r.idx}</span>
              <span>{BAND_ICON[r.band]}</span>
              <span className="text-slate-300 shrink-0 w-32 truncate">{r.txn_id}</span>
              <span className="text-slate-400 shrink-0 w-24 text-right">₹{Number(r.amount).toLocaleString("en-IN")}</span>
              <span className={`${BAND_COLOR[r.band]} shrink-0 w-28`}>{r.band.replace("_", " ")}</span>
              <span className="text-slate-600">{r.score.toFixed(1)}</span>
              <span className="text-slate-700 truncate">{r.match_type}</span>
            </div>
          ))}
          {!done && connected && (
            <div className="text-slate-600 animate-pulse px-2">● waiting for next record…</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-slate-500 text-xs mt-0.5">{label}</div>
    </div>
  );
}
