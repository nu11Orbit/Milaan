"use client";
// app/batches/[batchId]/results/page.tsx — Dashboard + case-category table

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { getMetrics, getEvaluation, type Metrics, type EvalResult } from "@/lib/api";

export default function ResultsPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const sp = useSearchParams();
  const runId = sp.get("runId") ?? undefined;

  const [metrics, setMetrics]   = useState<Metrics | null>(null);
  const [eval_,   setEval]      = useState<EvalResult | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([
      getMetrics(batchId, runId).then(setMetrics),
      getEvaluation(batchId, runId).then(setEval).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [batchId, runId]);

  if (loading) return <Loading />;
  if (!metrics) return <p className="text-red-400">Could not load metrics for this batch.</p>;

  const bandData = [
    { name: "Auto-Accept", value: metrics.by_confidence_band.auto_accept ?? 0, color: "#22c55e" },
    { name: "Review",      value: metrics.by_confidence_band.review      ?? 0, color: "#f59e0b" },
    { name: "Exception",   value: metrics.by_confidence_band.reject      ?? 0, color: "#ef4444" },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Results Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">Batch: <code className="text-blue-400">{batchId}</code></p>
        </div>
        <div className="flex gap-3">
          <Link href={`/batches/${batchId}/exceptions?runId=${runId ?? ""}`}
                className="border border-slate-700 hover:border-amber-500 text-slate-300 text-sm px-4 py-2 rounded-lg transition-colors">
            Exception Queue
          </Link>
        </div>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KPI label="Total Records"   value={String(metrics.total)} />
        <KPI label="Auto-Accept Rate" value={`${metrics.auto_accept_rate}%`} color="text-green-400" />
        <KPI label="Exception Rate"   value={`${metrics.exception_rate}%`}   color="text-red-400" />
        <KPI label="Avg Confidence"   value={`${metrics.avg_confidence_score}`} color="text-blue-400" />
      </div>

      {/* Precision/Recall if eval available */}
      {eval_ && (
        <div className="grid grid-cols-4 gap-4">
          <KPI label="Precision"  value={`${(eval_.accuracy.precision * 100).toFixed(1)}%`}
               color={eval_.success_criteria.precision_met ? "text-green-400" : "text-red-400"}
               sub={eval_.success_criteria.precision_met ? "✓ target met" : "⚠ below target"} />
          <KPI label="Recall"     value={`${(eval_.accuracy.recall * 100).toFixed(1)}%`}
               color={eval_.success_criteria.recall_met ? "text-green-400" : "text-red-400"}
               sub={eval_.success_criteria.recall_met ? "✓ target met" : "⚠ below target"} />
          <KPI label="F1 Score"   value={eval_.accuracy.f1.toFixed(3)} color="text-blue-400" />
          <KPI label="FP ₹ Cost" value={`₹${Number(eval_.accuracy.fp_rupee_cost).toLocaleString("en-IN")}`}
               color="text-amber-400" sub="auto-accept wrong calls" />
        </div>
      )}

      {/* Band chart + match type breakdown */}
      <div className="grid grid-cols-2 gap-6">
        <Card title="Confidence Band Distribution">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bandData} margin={{ top: 8 }}>
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} />
              <Bar dataKey="value" radius={[4,4,0,0]}>
                {bandData.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Match Type Breakdown">
          <div className="space-y-2 mt-2">
            {Object.entries(metrics.by_match_type).map(([type, count]) => {
              const pct = Math.round((count / metrics.total) * 100);
              return (
                <div key={type} className="flex items-center gap-3 text-sm">
                  <span className="text-slate-400 w-44 truncate">{type.replace(/_/g, " ")}</span>
                  <div className="flex-1 bg-slate-800 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-slate-300 w-10 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Per-category precision/recall table */}
      {eval_ && Object.keys(eval_.by_case_category).length > 0 && (
        <Card title="Case-Category Breakdown (Precision / Recall)">
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-slate-500 text-left border-b border-slate-800">
                <th className="pb-2 font-medium">Case</th>
                <th className="pb-2 font-medium text-right">TP</th>
                <th className="pb-2 font-medium text-right">FP</th>
                <th className="pb-2 font-medium text-right">FN</th>
                <th className="pb-2 font-medium text-right">Precision</th>
                <th className="pb-2 font-medium text-right">Recall</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(eval_.by_case_category).map(([cat, s]) => (
                <tr key={cat} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="py-2 text-slate-300">Case {cat}</td>
                  <td className="py-2 text-right text-green-400">{s.tp}</td>
                  <td className="py-2 text-right text-red-400">{s.fp}</td>
                  <td className="py-2 text-right text-amber-400">{s.fn}</td>
                  <td className="py-2 text-right text-slate-200">
                    {s.precision != null ? `${(s.precision * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="py-2 text-right text-slate-200">
                    {s.recall != null ? `${(s.recall * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Warnings */}
      {eval_?.warnings.length ? (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 space-y-1">
          {eval_.warnings.map((w, i) => <p key={i} className="text-amber-300 text-sm">⚠ {w}</p>)}
        </div>
      ) : null}
    </div>
  );
}

function KPI({ label, value, color = "text-white", sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-slate-400 text-sm mt-1">{label}</div>
      {sub && <div className="text-slate-600 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
      <h3 className="text-slate-300 text-sm font-medium mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Loading() {
  return <div className="text-slate-400 text-sm animate-pulse">Loading results…</div>;
}
