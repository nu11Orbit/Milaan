"use client";
// app/batches/[batchId]/results/page.tsx — Audited Reconciliation Dashboard

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
  getMatches,
  retryPendingLLM,
  triggerRun,
  type Metrics,
  type EvalResult,
  type CalibrationResult,
  type IntegrityResult,
  type Match,
} from "@/lib/api";
import {
  ShieldAlert,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Sliders,
  FileText,
  ExternalLink,
  Search,
  Check,
} from "lucide-react";

// ── Palette tokens ────────────────────────────────────────────────────────────
const T = {
  bgBase:           "#15120E",
  bgSurface:        "#1D1812",
  bgSurfaceRaised:  "#251E16",
  inkPrimary:       "#EDE6D6",
  inkMuted:         "#A69A85",
  accentForest:     "#2E4A38",
  accentCamel:      "#B4875A",
  signalMatch:      "#3C6B4C",
  signalMatchLight: "#7AAE88",
  signalReview:     "#C79A45",
  signalException:  "#A34C3F",
  signalExcLight:   "#C06050",
  borderHairline:   "rgba(237,230,214,0.08)",
  borderCamel:      "rgba(180,135,90,0.22)",
} as const;

const TOOLTIP_STYLE = {
  background: "#1D1812",
  border: "1px solid rgba(180,135,90,0.22)",
  borderRadius: 10,
  color: "#EDE6D6",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
} as const;

export default function ResultsPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const sp = useSearchParams();
  const runId = sp.get("runId") ?? undefined;

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [eval_, setEval] = useState<EvalResult | null>(null);
  const [calib, setCalib] = useState<CalibrationResult | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchFilter, setMatchFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"overview" | "matches" | "integrity" | "calibration">("overview");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<string | null>(null);
  const [startingRun, setStartingRun] = useState(false);

  const fetchFreshData = useCallback(() => {
    setLoading(true);
    Promise.all([
      getMetrics(batchId, runId).then(setMetrics).catch(() => setMetrics(null)),
      getEvaluation(batchId, runId).then(setEval).catch(() => {}),
      getCalibration(batchId, runId).then(setCalib).catch(() => {}),
      getIntegrity(batchId).then(setIntegrity).catch(() => {}),
      getMatches(batchId, runId).then((r) => setMatches(r.matches)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [batchId, runId]);

  useEffect(() => {
    let ignore = false;
    Promise.all([
      getMetrics(batchId, runId).then((m) => { if (!ignore) setMetrics(m); }).catch(() => { if (!ignore) setMetrics(null); }),
      getEvaluation(batchId, runId).then((e) => { if (!ignore) setEval(e); }).catch(() => {}),
      getCalibration(batchId, runId).then((c) => { if (!ignore) setCalib(c); }).catch(() => {}),
      getIntegrity(batchId).then((i) => { if (!ignore) setIntegrity(i); }).catch(() => {}),
      getMatches(batchId, runId).then((r) => { if (!ignore) setMatches(r.matches); }).catch(() => {}),
    ]).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
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
  if (!metrics) {
    return (
      <div className="pt-32 pb-16 px-4 max-w-2xl mx-auto text-center space-y-6">
        <div className="glass-panel p-8 rounded-2xl space-y-4 border border-[rgba(180,135,90,0.22)]">
          <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center bg-[rgba(180,135,90,0.15)] text-[#B4875A]">
            <RotateCcw className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold font-display" style={{ color: "var(--ink-primary)" }}>
            Reconciliation Run Not Completed
          </h2>
          <p className="text-xs font-mono text-[#A69A85] leading-relaxed">
            Batch <span className="font-bold text-[#EDE6D6]">{batchId}</span> was created but has no persisted matches yet (the run may have been interrupted or not triggered).
          </p>
          <div className="pt-3 flex flex-col sm:flex-row justify-center gap-3">
            <button
              disabled={startingRun}
              onClick={async () => {
                try {
                  setStartingRun(true);
                  const run = await triggerRun(batchId);
                  window.location.href = `/batches/${batchId}/run?runId=${run.run_id}`;
                } catch (e) {
                  setStartingRun(false);
                  alert("Failed to start run: " + (e instanceof Error ? e.message : "Unknown error"));
                }
              }}
              className="btn-primary-glow text-xs font-mono font-bold px-6 py-3 rounded-xl flex items-center justify-center gap-2"
            >
              <span>{startingRun ? "Initiating Pipeline…" : "Run Pipeline Now"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <Link
              href="/batches/new"
              className="btn-secondary-camel text-xs font-mono px-5 py-3 rounded-xl flex items-center justify-center"
            >
              Start Fresh Intake
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const bandData = [
    { name: "Auto-Accept", value: metrics.by_confidence_band.auto_accept ?? 0, color: "#3C6B4C" },
    { name: "Review",      value: metrics.by_confidence_band.review ?? 0,       color: "#C79A45" },
    { name: "Exception",   value: metrics.by_confidence_band.reject ?? 0,        color: "#A34C3F" },
  ];

  const tabClass = (tab: typeof activeTab) =>
    `px-4 py-2.5 rounded-xl transition-all cursor-pointer font-mono text-xs ${activeTab === tab ? "font-bold" : ""}`;

  const tabStyle = (tab: typeof activeTab): React.CSSProperties =>
    activeTab === tab
      ? {
          background: "#251E16",
          color: "#EDE6D6",
          border: "1px solid rgba(180,135,90,0.22)",
          boxShadow: "0 2px 12px -4px rgba(180,135,90,0.2)",
        }
      : { color: "#A69A85", border: "1px solid transparent" };

  const filteredMatches = matches.filter((m) => {
    if (matchFilter !== "all" && m.confidence_band !== matchFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const txnIds = (m.line_items ?? []).map((li) => li.txn_id ?? "").join(" ").toLowerCase();
    const invIds = (m.line_items ?? []).map((li) => li.invoice_id ?? "").join(" ").toLowerCase();
    return (
      (m.match_id ?? "").toLowerCase().includes(q) ||
      (m.match_type ?? "").toLowerCase().includes(q) ||
      (m.explanation_text ?? "").toLowerCase().includes(q) ||
      txnIds.includes(q) ||
      invIds.includes(q)
    );
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto pt-28 pb-16 px-4">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono"
            style={{
              background: "rgba(60,107,76,0.12)",
              border: "1px solid rgba(60,107,76,0.35)",
              color: "#7AAE88",
            }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Audited Reconciliation Results</span>
          </div>
          <h1
            className="text-3xl font-extrabold tracking-tight"
            style={{ color: "#EDE6D6", fontFamily: "var(--font-display)" }}
          >
            Ledger Performance Dashboard
          </h1>
          <p className="text-xs font-mono" style={{ color: "#A69A85" }}>
            Batch: <span className="font-bold" style={{ color: "#EDE6D6" }}>{batchId}</span>
            {runId && (
              <span> · Run: <span className="font-bold" style={{ color: "#B4875A" }}>{runId}</span></span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href={`/batches/${batchId}/settings`}
            className="btn-secondary-camel text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Thresholds</span>
          </Link>
          <Link
            href={`/batches/${batchId}/run?runId=${runId ?? ""}`}
            className="btn-secondary-camel text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Live Stream</span>
          </Link>
          <Link
            href={`/batches/${batchId}/exceptions?runId=${runId ?? ""}`}
            className="btn-primary-glow text-xs px-4 py-2 rounded-xl flex items-center gap-2"
          >
            <span>Exception Triage</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* TABS */}
      <div
        className="flex flex-wrap items-center gap-2 pb-3"
        style={{ borderBottom: "1px solid rgba(237,230,214,0.08)" }}
      >
        <button onClick={() => setActiveTab("overview")} className={tabClass("overview")} style={tabStyle("overview")}>
          1. Ledger Overview
        </button>
        <button onClick={() => setActiveTab("matches")} className={`${tabClass("matches")} flex items-center gap-1.5`} style={tabStyle("matches")}>
          <FileText className="w-3.5 h-3.5" style={{ color: "#B4875A" }} />
          <span>2. Reconciled Matches &amp; Lineage ({matches.length})</span>
        </button>
        <button onClick={() => setActiveTab("integrity")} className={`${tabClass("integrity")} flex items-center gap-1.5`} style={tabStyle("integrity")}>
          <ShieldAlert className="w-3.5 h-3.5" style={{ color: "#C79A45" }} />
          <span>3. Benford Forensic Audit</span>
        </button>
        <button onClick={() => setActiveTab("calibration")} className={`${tabClass("calibration")} flex items-center gap-1.5`} style={tabStyle("calibration")}>
          <TrendingUp className="w-3.5 h-3.5" style={{ color: "#B4875A" }} />
          <span>4. Isotonic Calibration</span>
        </button>
      </div>

      {/* PENDING LLM BANNER */}
      {(metrics.pending_llm_enrichment_count ?? 0) > 0 && (
        <div
          className="rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          style={{
            border: "1px solid rgba(199,154,69,0.35)",
            background: "rgba(199,154,69,0.06)",
          }}
        >
          <div className="flex items-start gap-3.5">
            <span className="text-2xl">⚡</span>
            <div>
              <p className="font-bold text-sm" style={{ color: "#C79A45" }}>
                {metrics.pending_llm_enrichment_count} records pending LLM narrative enrichment
              </p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(199,154,69,0.7)" }}>
                Deterministic scores (Passes 1–4) computed. LLM narrative will auto-upgrade once quota resets. No records are re-processed from scratch.
              </p>
              {retryResult && (
                <p
                  className="mt-2 text-xs font-mono font-medium px-2.5 py-1 rounded inline-block"
                  style={{ background: "#15120E", color: "#EDE6D6" }}
                >
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

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="space-y-8">

          {/* Headline KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard label="Total Processed"  value={String(metrics.total)}             sub="reconciliation events" />
            <KPICard label="Auto-Accept Rate" value={`${metrics.auto_accept_rate}%`}    tokenColor="#7AAE88" sub="high confidence band" />
            <KPICard label="Exception Rate"   value={`${metrics.exception_rate}%`}      tokenColor="#C06050" sub="unresolved anomalies" />
            <KPICard label="Mean Confidence"  value={`${metrics.avg_confidence_score}`} tokenColor="#B4875A" sub="Fellegi-Sunter blend" />
          </div>

          {/* Ground-Truth Accuracy */}
          {eval_ && (eval_.totals?.ground_truths ?? 0) > 0 ? (
            <div className="glass-panel rounded-2xl p-6 space-y-4">
              <div
                className="flex justify-between items-center pb-2"
                style={{ borderBottom: "1px solid rgba(237,230,214,0.08)" }}
              >
                <h3 className="text-base font-bold flex items-center gap-2" style={{ color: "#EDE6D6" }}>
                  <CheckCircle2 className="w-4 h-4" style={{ color: "#7AAE88" }} />
                  Ground-Truth Reconciliation Accuracy
                </h3>
                <span className="text-xs font-mono font-bold" style={{ color: "#A69A85" }}>
                  Target: ≥95% Precision
                </span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  label="Precision"
                  value={`${(eval_.accuracy.precision * 100).toFixed(1)}%`}
                  tokenColor={eval_.success_criteria.precision_met ? "#7AAE88" : "#C06050"}
                  sub={eval_.success_criteria.precision_met ? "✓ Target Met" : "⚠ Below 95%"}
                />
                <KPICard
                  label="Recall"
                  value={`${(eval_.accuracy.recall * 100).toFixed(1)}%`}
                  tokenColor={eval_.success_criteria.recall_met ? "#7AAE88" : "#C06050"}
                  sub={eval_.success_criteria.recall_met ? "✓ Target Met" : "⚠ Below 90%"}
                />
                <KPICard label="F1 Score"           value={eval_.accuracy.f1.toFixed(3)}                                        tokenColor="#B4875A"  sub="Harmonic Mean" />
                <KPICard label="False-Positive Cost" value={`₹${Number(eval_.accuracy.fp_rupee_cost).toLocaleString("en-IN")}`} tokenColor="#C79A45"  sub="Auto-accept errors" />
              </div>
            </div>
          ) : eval_ ? (
            <div
              className="glass-panel rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-mono text-xs"
              style={{ border: "1px solid rgba(180,135,90,0.22)", background: "rgba(180,135,90,0.04)" }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "#B4875A" }} />
                <div>
                  <p className="font-bold" style={{ color: "#EDE6D6" }}>Custom Upload Batch (Operational Mode)</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "#A69A85" }}>
                    Ground-truth annotations were not supplied for this upload. To benchmark automated precision, recall, and per-case accuracy, upload a ground truth CSV or run the built-in evaluation batch.
                  </p>
                </div>
              </div>
              <Link
                href="/batches/new"
                className="btn-secondary-camel text-[11px] px-3.5 py-1.5 rounded-lg shrink-0"
              >
                Run Evaluation Benchmark →
              </Link>
            </div>
          ) : null}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Confidence Band Bar Chart */}
            <DashboardCard title="Confidence Band Allocation">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={bandData} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fill: "#A69A85", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#A69A85", fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(180,135,90,0.06)" }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {bandData.map((d) => (
                      <Cell key={d.name} fill={d.color} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </DashboardCard>

            {/* Match Type Distribution */}
            <DashboardCard title="Match Type Distribution">
              <div className="space-y-3 pt-2 font-mono">
                {Object.entries(metrics.by_match_type).map(([type, count]) => {
                  const pct = Math.round((count / metrics.total) * 100);
                  return (
                    <div key={type} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="capitalize" style={{ color: "#A69A85" }}>{type.replace(/_/g, " ")}</span>
                        <span className="font-bold" style={{ color: "#EDE6D6" }}>{count} ({pct}%)</span>
                      </div>
                      <div
                        className="w-full h-2 rounded-full overflow-hidden"
                        style={{ background: "#15120E", border: "1px solid rgba(237,230,214,0.08)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: "linear-gradient(to right, #2E4A38, #B4875A)" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </DashboardCard>
          </div>

          {/* Per-Case Table */}
          {eval_ && (eval_.totals?.ground_truths ?? 0) > 0 && Object.keys(eval_.by_case_category).length > 0 && (
            <DashboardCard title="Per-Case Performance Breakdown (Indian SME Scenarios)">
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono mt-2">
                  <thead>
                    <tr
                      className="text-left uppercase tracking-wider"
                      style={{ color: "#A69A85", borderBottom: "1px solid rgba(237,230,214,0.08)" }}
                    >
                      <th className="pb-2.5 font-semibold">Case Category</th>
                      <th className="pb-2.5 font-semibold text-right">TP</th>
                      <th className="pb-2.5 font-semibold text-right">FP</th>
                      <th className="pb-2.5 font-semibold text-right">FN</th>
                      <th className="pb-2.5 font-semibold text-right">Precision</th>
                      <th className="pb-2.5 font-semibold text-right">Recall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(eval_.by_case_category).map(([cat, s]) => (
                      <tr
                        key={cat}
                        style={{ borderBottom: "1px solid rgba(237,230,214,0.05)" }}
                      >
                        <td className="py-2.5 font-semibold" style={{ color: "#EDE6D6" }}>Case {cat}</td>
                        <td className="py-2.5 text-right" style={{ color: "#7AAE88" }}>{s.tp}</td>
                        <td className="py-2.5 text-right" style={{ color: "#C06050" }}>{s.fp}</td>
                        <td className="py-2.5 text-right" style={{ color: "#C79A45" }}>{s.fn}</td>
                        <td className="py-2.5 text-right" style={{ color: "#EDE6D6" }}>
                          {s.precision != null ? `${(s.precision * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="py-2.5 text-right" style={{ color: "#EDE6D6" }}>
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

      {/* TAB 2: RECONCILED MATCHES & AUDIT LINEAGE */}
      {activeTab === "matches" && (
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4" style={{ borderBottom: "1px solid rgba(237,230,214,0.08)" }}>
              <div>
                <h3 className="text-base font-bold" style={{ color: "#EDE6D6" }}>
                  All Reconciled Items &amp; Decision Lineage
                </h3>
                <p className="text-xs mt-0.5" style={{ color: "#A69A85" }}>
                  Browse every matched transaction pair, inspect confidence scoring, and view full 5-pass forensic audit trails.
                </p>
              </div>

              {/* Filter pills */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {[
                  { id: "all", label: `All (${matches.length})` },
                  { id: "auto_accept", label: `Auto-Accept (${matches.filter(m => m.confidence_band === "auto_accept").length})` },
                  { id: "review", label: `Review (${matches.filter(m => m.confidence_band === "review").length})` },
                  { id: "reject", label: `Exceptions (${matches.filter(m => m.confidence_band === "reject").length})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setMatchFilter(f.id)}
                    className="px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    style={
                      matchFilter === f.id
                        ? { background: "#251E16", color: "#B4875A", border: "1px solid rgba(180,135,90,0.35)", fontWeight: "bold" }
                        : { background: "rgba(237,230,214,0.04)", color: "#A69A85", border: "1px solid rgba(237,230,214,0.08)" }
                    }
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#A69A85" }} />
              <input
                type="text"
                placeholder="Search by Match ID, Bank Txn ID, Invoice ID, or description…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-xs font-mono outline-none transition-all"
                style={{
                  background: "#15120E",
                  border: "1px solid rgba(180,135,90,0.22)",
                  color: "#EDE6D6",
                }}
              />
            </div>

            {/* Matches Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr
                    className="text-left uppercase tracking-wider"
                    style={{ color: "#A69A85", borderBottom: "1px solid rgba(237,230,214,0.08)" }}
                  >
                    <th className="pb-3 font-semibold">Match ID</th>
                    <th className="pb-3 font-semibold">Bank Txn(s)</th>
                    <th className="pb-3 font-semibold">Matched Invoice(s)</th>
                    <th className="pb-3 font-semibold text-right">Allocated ₹</th>
                    <th className="pb-3 font-semibold text-center">Score</th>
                    <th className="pb-3 font-semibold text-center">Band</th>
                    <th className="pb-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center" style={{ color: "#A69A85" }}>
                        No matches match current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredMatches.map((m) => {
                      const txnIds = Array.from(
                        new Set((m.line_items ?? []).map((li) => li.txn_id).filter((id): id is string => Boolean(id)))
                      );
                      const invIds = Array.from(
                        new Set((m.line_items ?? []).map((li) => li.invoice_id).filter((id): id is string => Boolean(id)))
                      );
                      const allocatedSum = (m.line_items ?? []).reduce(
                        (sum, li) => sum + (parseFloat(li.allocated_amount) || 0),
                        0
                      );
                      const isAuto = m.confidence_band === "auto_accept";
                      const isReview = m.confidence_band === "review";

                      return (
                        <tr
                          key={m.match_id}
                          className="hover:bg-[#251E16]/40 transition-colors"
                          style={{ borderBottom: "1px solid rgba(237,230,214,0.05)" }}
                        >
                          <td className="py-3 font-bold" style={{ color: "#EDE6D6" }}>
                            {m.match_id}
                          </td>
                          <td className="py-3" style={{ color: "#A69A85" }}>
                            {txnIds.length > 0 ? txnIds.join(", ") : "—"}
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1">
                              {invIds.length > 0 ? (
                                invIds.map((inv, idx) => (
                                  <span
                                    key={`${m.match_id}-inv-${inv}-${idx}`}
                                    className="px-2 py-0.5 rounded text-[10px] font-mono font-medium"
                                    style={{
                                      background: "#251E16",
                                      border: "1px solid rgba(180,135,90,0.3)",
                                      color: "#B4875A",
                                    }}
                                  >
                                    {inv}
                                  </span>
                                ))
                              ) : (
                                <span style={{ color: "#A69A85" }}>Unallocated</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 text-right font-bold" style={{ color: "#EDE6D6" }}>
                            ₹{allocatedSum.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 text-center">
                            <span
                              className="font-bold"
                              style={{
                                color: isAuto ? "#7AAE88" : isReview ? "#C79A45" : "#C06050",
                              }}
                            >
                              {m.confidence_score.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-3 text-center">
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-block"
                              style={
                                isAuto
                                  ? { background: "rgba(60,107,76,0.15)", color: "#7AAE88", border: "1px solid rgba(60,107,76,0.35)" }
                                  : isReview
                                  ? { background: "rgba(199,154,69,0.15)", color: "#C79A45", border: "1px solid rgba(199,154,69,0.35)" }
                                  : { background: "rgba(163,76,63,0.15)", color: "#C06050", border: "1px solid rgba(163,76,63,0.35)" }
                              }
                            >
                              {m.confidence_band.replace("_", " ")}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <Link
                              href={`/batches/${batchId}/matches/${m.match_id}`}
                              className="inline-flex items-center gap-1 font-semibold hover:underline"
                              style={{ color: "#B4875A" }}
                            >
                              <span>Audit Trail</span>
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: BENFORD FORENSIC AUDIT */}
      {activeTab === "integrity" && integrity && (
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-6 space-y-4">
            <div
              className="flex justify-between items-center pb-3"
              style={{ borderBottom: "1px solid rgba(237,230,214,0.08)" }}
            >
              <div>
                <h3 className="text-lg font-bold" style={{ color: "#EDE6D6" }}>
                  Benford&apos;s Law Goodness-of-Fit Audit
                </h3>
                <p className="text-xs mt-0.5" style={{ color: "#A69A85" }}>
                  Forensic audit comparing leading-digit distribution against theoretical logarithmic distribution.
                </p>
              </div>
              <span
                className="px-3 py-1 rounded-full font-mono text-xs font-bold uppercase tracking-wider"
                style={
                  integrity.overall_fraud_risk === "low"
                    ? { background: "rgba(60,107,76,0.15)", color: "#7AAE88", border: "1px solid rgba(60,107,76,0.4)" }
                    : integrity.overall_fraud_risk === "medium"
                    ? { background: "rgba(199,154,69,0.15)", color: "#C79A45", border: "1px solid rgba(199,154,69,0.4)" }
                    : { background: "rgba(163,76,63,0.15)", color: "#C06050", border: "1px solid rgba(163,76,63,0.4)" }
                }
              >
                Overall Risk: {integrity.overall_fraud_risk}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <div>
                <div className="text-xs font-mono font-semibold mb-2" style={{ color: "#A69A85" }}>
                  Invoice Amounts (χ² = {integrity.invoice_analysis.chi2_statistic}, p = {integrity.invoice_analysis.p_value})
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={integrity.invoice_analysis.digit_distribution} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="digit" tick={{ fill: "#A69A85", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#A69A85", fontSize: 11 }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(180,135,90,0.06)" }} />
                    <Bar dataKey="observed_pct" name="Observed %"    fill="#B4875A" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expected_pct" name="Theoretical %" fill="#A69A85" fillOpacity={0.45} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div>
                <div className="text-xs font-mono font-semibold mb-2" style={{ color: "#A69A85" }}>
                  Bank Transaction Amounts (χ² = {integrity.transaction_analysis.chi2_statistic}, p = {integrity.transaction_analysis.p_value})
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={integrity.transaction_analysis.digit_distribution} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="digit" tick={{ fill: "#A69A85", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#A69A85", fontSize: 11 }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(180,135,90,0.06)" }} />
                    <Bar dataKey="observed_pct" name="Observed %"    fill="#3C6B4C" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expected_pct" name="Theoretical %" fill="#A69A85" fillOpacity={0.45} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {integrity.suspicious_counterparties.length > 0 ? (
            <DashboardCard title="Antibenford Clustered Counterparties (Potential Fabrication / Threshold Split)">
              <div className="space-y-3 font-mono text-xs">
                {integrity.suspicious_counterparties.map((cp, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl space-y-1.5"
                    style={{ background: "#15120E", border: "1px solid rgba(199,154,69,0.28)" }}
                  >
                    <div className="flex justify-between items-center font-bold" style={{ color: "#EDE6D6" }}>
                      <span>{cp.counterparty_name}</span>
                      <span style={{ color: "#C79A45" }}>{cp.dominant_ratio}% Clustered on Digit &apos;{cp.dominant_leading_digit}&apos;</span>
                    </div>
                    <p className="text-[11px]" style={{ color: "#A69A85" }}>{cp.flag_reason}</p>
                    <div className="text-[10px]" style={{ color: "#B4875A" }}>
                      Total Volume: ₹{Number(cp.total_amount_sum).toLocaleString("en-IN")} across {cp.total_invoices} invoices
                    </div>
                  </div>
                ))}
              </div>
            </DashboardCard>
          ) : (
            <div
              className="p-5 rounded-2xl glass-panel text-xs font-mono flex items-center gap-2"
              style={{ border: "1px solid rgba(60,107,76,0.3)", color: "#7AAE88" }}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>No abnormal counterparty leading-digit clusters detected across this batch.</span>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CALIBRATION CURVE */}
      {activeTab === "calibration" && calib && (
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-6 space-y-4">
            <div
              className="flex justify-between items-center pb-3"
              style={{ borderBottom: "1px solid rgba(237,230,214,0.08)" }}
            >
              <div>
                <h3 className="text-lg font-bold" style={{ color: "#EDE6D6" }}>
                  Isotonic Confidence Calibration (Reliability Diagram)
                </h3>
                <p className="text-xs mt-0.5" style={{ color: "#A69A85" }}>
                  Verifies whether predicted confidence scores map to empirical ground-truth true positive rates.
                </p>
              </div>
              {calib.calibrated_metrics && (
                <div className="flex items-center gap-4 text-xs font-mono">
                  <div>
                    <span style={{ color: "#A69A85" }}>Brier Score: </span>
                    <span className="font-bold" style={{ color: "#7AAE88" }}>{calib.calibrated_metrics.brier_score}</span>
                  </div>
                  <div>
                    <span style={{ color: "#A69A85" }}>ECE: </span>
                    <span className="font-bold" style={{ color: "#B4875A" }}>{calib.calibrated_metrics.expected_calibration_error}</span>
                  </div>
                </div>
              )}
            </div>

            {calib.calibration_curve?.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={calib.calibration_curve} margin={{ top: 12, right: 20, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(237,230,214,0.08)" />
                    <XAxis dataKey="bin_label" tick={{ fill: "#A69A85", fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#A69A85", fontSize: 11 }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Line type="monotone" dataKey="ideal"              name="Ideal (Perfect Calibration)"      stroke="#A69A85" strokeDasharray="5 5" dot={false} />
                    <Line type="monotone" dataKey="empirical_accuracy" name="Empirical True Positive Rate (%)" stroke="#7AAE88" strokeWidth={2.5} />
                    <Line type="monotone" dataKey="mean_confidence"    name="Mean Confidence (%)"              stroke="#B4875A" strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-xs font-mono" style={{ color: "#A69A85" }}>
                Calibration curve requires ground-truth labels — run with an evaluation set to populate.
              </div>
            )}
            {calib.interpretation && (
              <p className="text-xs font-mono pt-2" style={{ color: "#A69A85" }}>{calib.interpretation}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({
  label,
  value,
  tokenColor,
  sub,
}: {
  label: string;
  value: string;
  tokenColor?: string;
  sub?: string;
}) {
  return (
    <div className="glass-panel rounded-2xl p-5 shadow-lg space-y-1">
      <div
        className="font-mono text-2xl sm:text-3xl font-extrabold tabular-nums"
        style={{ color: tokenColor ?? "var(--ink-primary)" }}
      >
        {value}
      </div>
      <div className="text-xs font-semibold" style={{ color: "var(--ink-primary)" }}>{label}</div>
      {sub && <div className="text-[11px] font-mono" style={{ color: "var(--ink-muted)" }}>{sub}</div>}
    </div>
  );
}

function DashboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl p-6 shadow-lg space-y-3">
      <h3 className="text-sm font-bold" style={{ color: "var(--ink-primary)" }}>{title}</h3>
      {children}
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
        Loading Audited Ledger Data…
      </span>
    </div>
  );
}
