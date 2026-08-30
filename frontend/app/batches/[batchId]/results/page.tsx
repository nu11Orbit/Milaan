"use client";
// app/batches/[batchId]/results/page.tsx — Modern FinTech Results Dashboard & Forensic Analytics

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend
} from "recharts";
import {
  getMetrics,
  getEvaluation,
  getCalibration,
  getIntegrity,
  retryPendingLLM,
  type Metrics,
  type EvalResult,
  type CalibrationResult,
  type IntegrityResult,
} from "@/lib/api";
import {
  ShieldAlert,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  ArrowRight,
  TrendingUp,
} from "lucide-react";

export default function ResultsPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const sp = useSearchParams();
  const runId = sp.get("runId") ?? undefined;

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [eval_, setEval] = useState<EvalResult | null>(null);
  const [calib, setCalib] = useState<CalibrationResult | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "integrity" | "calibration">("overview");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<string | null>(null);

  const fetchFreshData = useCallback(() => {
    setLoading(true);
    Promise.all([
      getMetrics(batchId, runId).then(setMetrics),
      getEvaluation(batchId, runId).then(setEval).catch(() => {}),
      getCalibration(batchId, runId).then(setCalib).catch(() => {}),
      getIntegrity(batchId).then(setIntegrity).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [batchId, runId]);

  useEffect(() => {
    let ignore = false;
    Promise.all([
      getMetrics(batchId, runId).then((m) => { if (!ignore) setMetrics(m); }),
      getEvaluation(batchId, runId).then((e) => { if (!ignore) setEval(e); }).catch(() => {}),
      getCalibration(batchId, runId).then((c) => { if (!ignore) setCalib(c); }).catch(() => {}),
      getIntegrity(batchId).then((i) => { if (!ignore) setIntegrity(i); }).catch(() => {}),
    ]).finally(() => {
      if (!ignore) setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [batchId, runId]);

  async function handleRetryLLM() {
    setRetrying(true);
    setRetryResult(null);
    try {
      const res = await retryPendingLLM(batchId, runId);
      setRetryResult(res.message ?? "Retry complete");
      fetchFreshData();
    } catch {
      setRetryResult("Retry request failed — check backend logs");
    } finally {
      setRetrying(false);
    }
  }

  if (loading) return <Loading />;
  if (!metrics) return <p className="text-rose-400 font-mono">Could not load metrics for this batch.</p>;

  const bandData = [
    { name: "Auto-Accept", value: metrics.by_confidence_band.auto_accept ?? 0, color: "#10B981" },
    { name: "Review", value: metrics.by_confidence_band.review ?? 0, color: "#F59E0B" },
    { name: "Exception", value: metrics.by_confidence_band.reject ?? 0, color: "#EF4444" },
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto py-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Audited Reconciliation Results</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Ledger Performance Dashboard</h1>
          <p className="text-slate-400 text-xs font-mono">
            Batch: <span className="text-slate-200 font-bold">{batchId}</span>
            {runId && <span> · Run: <span className="text-emerald-400 font-bold">{runId}</span></span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/batches/${batchId}/exceptions?runId=${runId ?? ""}`}
            className="btn-secondary-glass text-xs px-4 py-2.5 rounded-xl flex items-center gap-2"
          >
            <span>Exception Triage</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-3 text-xs font-mono">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2.5 rounded-xl transition-all cursor-pointer ${
            activeTab === "overview"
              ? "bg-slate-800 text-white border border-emerald-500/40 font-bold shadow-md shadow-emerald-500/10"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          1. Ledger Overview & Accuracies
        </button>
        <button
          onClick={() => setActiveTab("integrity")}
          className={`px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === "integrity"
              ? "bg-slate-800 text-white border border-emerald-500/40 font-bold shadow-md shadow-emerald-500/10"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          <span>2. Benford Forensic Audit</span>
        </button>
        <button
          onClick={() => setActiveTab("calibration")}
          className={`px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === "calibration"
              ? "bg-slate-800 text-white border border-emerald-500/40 font-bold shadow-md shadow-emerald-500/10"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
          <span>3. Isotonic Calibration Curve</span>
        </button>
      </div>

      {/* ── Pending LLM Banner ── */}
      {(metrics.pending_llm_enrichment_count ?? 0) > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.08] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span className="text-2xl">⚡</span>
            <div>
              <p className="font-bold text-amber-300 text-sm">
                {metrics.pending_llm_enrichment_count} records pending LLM narrative enrichment
              </p>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Deterministic scores (Passes 1–4) computed. LLM narrative will auto-upgrade once quota resets. No records are re-processed from scratch.
              </p>
              {retryResult && (
                <p className="mt-2 text-xs font-mono font-medium text-slate-100 bg-slate-950 px-2.5 py-1 rounded inline-block">
                  {retryResult}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleRetryLLM}
            disabled={retrying}
            className="btn-primary-glow px-4 py-2 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${retrying ? "animate-spin" : ""}`} />
            <span>{retrying ? "Retrying LLM…" : "Retry Pass 5"}</span>
          </button>
        </div>
      )}

      {/* ── TAB 1: OVERVIEW ── */}
      {activeTab === "overview" && (
        <div className="space-y-8">
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard label="Total Processed" value={String(metrics.total)} sub="reconciliation events" />
            <KPICard label="Auto-Accept Rate" value={`${metrics.auto_accept_rate}%`} color="text-emerald-400" sub="high confidence band" />
            <KPICard label="Exception Rate" value={`${metrics.exception_rate}%`} color="text-rose-400" sub="unresolved anomalies" />
            <KPICard label="Mean Confidence" value={`${metrics.avg_confidence_score}`} color="text-cyan-400" sub="Fellegi-Sunter blend" />
          </div>

          {/* Accuracy Metrics if Evaluation Available */}
          {eval_ && (
            <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4 shadow-xl">
              <div className="flex justify-between items-center pb-2 border-b border-white/[0.08]">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Ground-Truth Reconciliation Accuracy
                </h3>
                <span className="text-xs font-mono text-emerald-400 font-bold">Target: ≥95% Precision</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  label="Precision"
                  value={`${(eval_.accuracy.precision * 100).toFixed(1)}%`}
                  color={eval_.success_criteria.precision_met ? "text-emerald-400" : "text-rose-400"}
                  sub={eval_.success_criteria.precision_met ? "✓ Target Met" : "⚠ Below 95%"}
                />
                <KPICard
                  label="Recall"
                  value={`${(eval_.accuracy.recall * 100).toFixed(1)}%`}
                  color={eval_.success_criteria.recall_met ? "text-emerald-400" : "text-rose-400"}
                  sub={eval_.success_criteria.recall_met ? "✓ Target Met" : "⚠ Below 90%"}
                />
                <KPICard label="F1 Score" value={eval_.accuracy.f1.toFixed(3)} color="text-cyan-400" sub="Harmonic Mean" />
                <KPICard
                  label="False-Positive Cost"
                  value={`₹${Number(eval_.accuracy.fp_rupee_cost).toLocaleString("en-IN")}`}
                  color="text-amber-400"
                  sub="Auto-accept errors"
                />
              </div>
            </div>
          )}

          {/* Charts: Confidence Band + Match Types */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DashboardCard title="Confidence Band Allocation">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={bandData} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fill: "#94A3B8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#0D1320", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 12, color: "#F8FAFC" }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {bandData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardCard>

            <DashboardCard title="Match Type Distribution">
              <div className="space-y-3 pt-2 font-mono">
                {Object.entries(metrics.by_match_type).map(([type, count]) => {
                  const pct = Math.round((count / metrics.total) * 100);
                  return (
                    <div key={type} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400 capitalize">{type.replace(/_/g, " ")}</span>
                        <span className="text-slate-100 font-bold">{count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-white/5">
                        <div className="bg-gradient-to-r from-emerald-500 to-[var(--arctic)] h-full rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </DashboardCard>
          </div>

          {/* Case Categories Breakdown Table */}
          {eval_ && Object.keys(eval_.by_case_category).length > 0 && (
            <DashboardCard title="Per-Case Performance Breakdown (Indian SME Scenarios)">
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono mt-2">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/[0.08] pb-2 text-left uppercase tracking-wider">
                      <th className="pb-2.5 font-semibold">Case Category</th>
                      <th className="pb-2.5 font-semibold text-right">TP</th>
                      <th className="pb-2.5 font-semibold text-right">FP</th>
                      <th className="pb-2.5 font-semibold text-right">FN</th>
                      <th className="pb-2.5 font-semibold text-right">Precision</th>
                      <th className="pb-2.5 font-semibold text-right">Recall</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {Object.entries(eval_.by_case_category).map(([cat, s]) => (
                      <tr key={cat} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 text-slate-200 font-semibold">Case {cat}</td>
                        <td className="py-2.5 text-right text-emerald-400">{s.tp}</td>
                        <td className="py-2.5 text-right text-rose-400">{s.fp}</td>
                        <td className="py-2.5 text-right text-amber-400">{s.fn}</td>
                        <td className="py-2.5 text-right text-slate-100">
                          {s.precision != null ? `${(s.precision * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="py-2.5 text-right text-slate-100">
                          {s.recall != null ? `${(s.recall * 100).toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashboardCard>
          )}
        </div>
      )}

      {/* ── TAB 2: BENFORD FORENSIC AUDIT ── */}
      {activeTab === "integrity" && integrity && (
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4 shadow-xl">
            <div className="flex justify-between items-center pb-3 border-b border-white/[0.08]">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Benford&apos;s Law Goodness-of-Fit Audit
                </h3>
                <p className="text-xs text-slate-400">
                  Forensic audit comparing leading-digit distribution against theoretical logarithmic distribution ($P(d) = \log_{10}(1 + 1/d)$).
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full font-mono text-xs font-bold uppercase tracking-wider ${
                integrity.overall_fraud_risk === "low"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/40"
                  : integrity.overall_fraud_risk === "medium"
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/40"
                  : "bg-rose-500/15 text-rose-400 border border-rose-500/40"
              }`}>
                Overall Risk: {integrity.overall_fraud_risk}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <div>
                <div className="text-xs font-mono text-cyan-400 font-semibold mb-2">Invoice Amounts (χ² = {integrity.invoice_analysis.chi2_statistic}, p = {integrity.invoice_analysis.p_value})</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={integrity.invoice_analysis.digit_distribution} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="digit" tick={{ fill: "#94A3B8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#0D1320", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 12 }} />
                    <Bar dataKey="observed_pct" name="Observed %" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expected_pct" name="Theoretical %" fill="#64748B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div>
                <div className="text-xs font-mono text-emerald-400 font-semibold mb-2">Bank Transaction Amounts (χ² = {integrity.transaction_analysis.chi2_statistic}, p = {integrity.transaction_analysis.p_value})</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={integrity.transaction_analysis.digit_distribution} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="digit" tick={{ fill: "#94A3B8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#0D1320", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 12 }} />
                    <Bar dataKey="observed_pct" name="Observed %" fill="#10B981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expected_pct" name="Theoretical %" fill="#64748B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Antibenford Suspicious Counterparties */}
          {integrity.suspicious_counterparties.length > 0 ? (
            <DashboardCard title="Antibenford Clustered Counterparties (Potential Fabrication / Threshold Split)">
              <div className="space-y-3 font-mono text-xs">
                {integrity.suspicious_counterparties.map((cp, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-1.5">
                    <div className="flex justify-between items-center font-bold text-slate-100">
                      <span>{cp.counterparty_name}</span>
                      <span className="text-amber-400">{cp.dominant_ratio}% Clustered on Digit &apos;{cp.dominant_leading_digit}&apos;</span>
                    </div>
                    <p className="text-[11px] text-slate-400">{cp.flag_reason}</p>
                    <div className="text-[10px] text-cyan-400">Total Volume: ₹{Number(cp.total_amount_sum).toLocaleString("en-IN")} across {cp.total_invoices} invoices</div>
                  </div>
                ))}
              </div>
            </DashboardCard>
          ) : (
            <div className="p-5 rounded-2xl glass-panel border border-emerald-500/30 text-emerald-400 text-xs font-mono flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>No abnormal counterparty leading-digit clusters detected across this batch.</span>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: CALIBRATION CURVE ── */}
      {activeTab === "calibration" && calib && (
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4 shadow-xl">
            <div className="flex justify-between items-center pb-3 border-b border-white/[0.08]">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Isotonic Confidence Calibration (Reliability Diagram)
                </h3>
                <p className="text-xs text-slate-400">
                  Verifies whether predicted confidence scores map to empirical ground-truth true positive rates.
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-slate-400">Brier Score: </span>
                  <span className="text-emerald-400 font-bold">{calib.calibrated_metrics.brier_score}</span>
                </div>
                <div>
                  <span className="text-slate-400">ECE: </span>
                  <span className="text-cyan-400 font-bold">{calib.calibrated_metrics.expected_calibration_error}</span>
                </div>
              </div>
            </div>

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={calib.calibration_curve} margin={{ top: 12, right: 20, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="bin_label" tick={{ fill: "#94A3B8", fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#94A3B8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#0D1320", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="ideal" name="Ideal (Perfect Calibration)" stroke="#64748B" strokeDasharray="5 5" dot={false} />
                  <Line type="monotone" dataKey="empirical_accuracy" name="Empirical True Positive Rate (%)" stroke="#10B981" strokeWidth={2.5} />
                  <Line type="monotone" dataKey="mean_confidence" name="Mean Confidence (%)" stroke="#06B6D4" strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-slate-400 font-mono pt-2">
              {calib.interpretation}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({ label, value, color = "text-white", sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-5 shadow-lg space-y-1">
      <div className={`font-mono text-2xl sm:text-3xl font-extrabold ${color} tabular-nums`}>{value}</div>
      <div className="text-xs text-slate-300 font-semibold">{label}</div>
      {sub && <div className="text-[11px] text-slate-500 font-mono">{sub}</div>}
    </div>
  );
}

function DashboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl p-6 shadow-lg space-y-3">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <div className="h-64 flex items-center justify-center space-y-2 flex-col">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      <span className="text-xs font-mono text-slate-400">Loading Audited Ledger Data…</span>
    </div>
  );
}
