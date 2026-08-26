// lib/api.ts — typed fetch wrappers for every backend endpoint

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

// ── Upload ────────────────────────────────────────────────────────────────────
export async function uploadBatch(formData: FormData) {
  const res = await fetch(`${BASE}/api/batches`, { method: "POST", body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Run ───────────────────────────────────────────────────────────────────────
export function triggerRun(batchId: string) {
  return req<{ batch_id: string; run_id: string; stream_url: string }>(`/api/batches/${batchId}/run`, { method: "POST" });
}

export function getRunStatus(batchId: string, runId: string) {
  return req<{ status: string; match_count?: number }>(`/api/batches/${batchId}/run/${runId}`);
}

// ── Results ───────────────────────────────────────────────────────────────────
export function getMatches(batchId: string, runId?: string, band?: string, limit = 200) {
  const q = new URLSearchParams();
  if (runId) q.set("run_id", runId);
  if (band) q.set("band", band);
  q.set("limit", String(limit));
  return req<{ count: number; matches: Match[] }>(`/api/batches/${batchId}/matches?${q}`);
}

export function getExceptions(batchId: string, runId?: string) {
  const q = runId ? `?run_id=${runId}` : "";
  return req<{ count: number; exceptions: Exception[] }>(`/api/batches/${batchId}/exceptions${q}`);
}

export function getMetrics(batchId: string, runId?: string) {
  const q = runId ? `?run_id=${runId}` : "";
  return req<Metrics>(`/api/batches/${batchId}/metrics${q}`);
}

export function getEvaluation(batchId: string, runId?: string) {
  const q = runId ? `?run_id=${runId}` : "";
  return req<EvalResult>(`/api/batches/${batchId}/evaluate${q}`);
}

// ── Audit ─────────────────────────────────────────────────────────────────────
export function getAuditTrail(matchId: string) {
  return req<AuditTrail>(`/api/matches/${matchId}/audit`);
}

export function submitReview(matchId: string, action: "accepted" | "rejected", reviewerId: string) {
  return req<{ review_action: string }>(`/api/matches/${matchId}/review`, {
    method: "POST",
    body: JSON.stringify({ action, reviewer_id: reviewerId }),
  });
}

// ── Thresholds ────────────────────────────────────────────────────────────────
export function getThresholds() {
  return req<{ threshold_auto_accept: number; threshold_review: number }>("/api/config/thresholds");
}

export function updateThresholds(autoAccept: number, review: number) {
  return req("/api/config/thresholds", {
    method: "POST",
    body: JSON.stringify({ threshold_auto_accept: autoAccept, threshold_review: review }),
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LineItem { txn_id: string | null; invoice_id: string | null; allocated_amount: string }

export interface Match {
  match_id: string; match_type: string; confidence_score: number;
  confidence_band: "auto_accept" | "review" | "reject";
  explanation_text: string | null; explanation_source: string | null;
  line_items: LineItem[]; created_at: string;
  reviewed_by: string | null; review_action: string | null;
}

export interface Exception {
  match_id: string; exception_reason_category: string | null;
  exception_reason_detail: string | null; line_items: LineItem[]; created_at: string;
}

export interface Metrics {
  batch_id: string; total: number;
  by_confidence_band: Record<string, number>;
  by_match_type: Record<string, number>;
  by_explanation_source: Record<string, number>;
  avg_confidence_score: number; auto_accept_rate: number; exception_rate: number;
  thresholds_used: { auto_accept: number; review: number };
}

export interface EvalResult {
  batch_id: string; run_id: string | null;
  totals: { predictions: number; ground_truths: number; auto_accept: number; review: number; reject: number };
  accuracy: { true_positives: number; false_positives: number; false_negatives: number;
               precision: number; recall: number; f1: number; fp_rupee_cost: string };
  exception_completeness: { with_reason: number; without_reason: number; completeness_pct: number };
  by_case_category: Record<string, { tp: number; fp: number; fn: number; precision?: number; recall?: number }>;
  success_criteria: { precision_target: string; precision_met: boolean; recall_target: string; recall_met: boolean;
                      exception_completeness_target: string; exception_completeness_met: boolean };
  warnings: string[];
}

export interface AuditEntry {
  log_id: string; pass_name: string; score_delta: number | null; score_after: number | null;
  reasoning_text: string | null; raw_llm_response: string | null;
  llm_provider: string | null; llm_model: string | null;
  llm_fallback_used: boolean; llm_both_failed: boolean; timestamp: string;
}

export interface AuditTrail {
  match_id: string; match_type: string; confidence_score: number; confidence_band: string;
  explanation_text: string | null; threshold_snapshot: Record<string, number>;
  reviewed_by: string | null; review_action: string | null; audit_trail: AuditEntry[];
}
