"use client";
// app/batches/new/page.tsx — Autonomous Reconciliation Intake Portal

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadBatch, loadSampleBatch, triggerRun } from "@/lib/api";
import { UploadCloud, AlertCircle, CheckCircle2, ArrowRight, Sparkles, Play } from "lucide-react";

export default function NewBatchPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState("MER-001");
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [invFile, setInvFile] = useState<File | null>(null);
  const [gtFile, setGtFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<Array<{ errors: Record<string, string[]> }>>([]);

  async function handleLoadSample() {
    setLoadingSample(true);
    setError(null);
    try {
      const batch = await loadSampleBatch();
      const run = await triggerRun(batch.batch_id);
      router.push(`/batches/${batch.batch_id}/run?runId=${run.run_id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load synthetic benchmark batch";
      setError(msg);
      setLoadingSample(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bankFile || !invFile) {
      setError("Both Bank Statement CSV and Invoice Register CSV are required.");
      return;
    }
    setLoading(true);
    setError(null);
    setParseErrors([]);
    try {
      const fd = new FormData();
      fd.append("merchant_id", merchantId);
      fd.append("bank_csv", bankFile);
      fd.append("invoice_csv", invFile);
      if (gtFile) {
        fd.append("ground_truth_csv", gtFile);
      }
      const batch = await uploadBatch(fd);
      if (batch.parse_errors?.length) setParseErrors(batch.parse_errors);
      
      // Trigger reconciliation pipeline run immediately
      const run = await triggerRun(batch.batch_id);
      router.push(`/batches/${batch.batch_id}/run?runId=${run.run_id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full min-h-screen bg-[#15120E] text-[#EDE6D6] pt-28 pb-16 px-6 sm:px-12 flex justify-center">
      <div className="max-w-3xl w-full space-y-10">
        
        {/* Editorial Header */}
        <div className="space-y-3 border-b border-[rgba(237,230,214,0.08)] pb-8">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#6E2B34]" />
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#B4875A]">
              Intake Dispatch · Section 194C / 194J Multilateral Ingestion
            </span>
          </div>
          <h1 className="font-display font-light text-4xl sm:text-5xl text-[#EDE6D6] tracking-tight">
            New Ledger Reconciliation Intake
          </h1>
          <p className="font-body text-base text-[#A69A85] leading-relaxed max-w-2xl">
            Upload your unstructured bank statement and ERP invoice register. Our engine parses Indian ₹ currency structures, Lakhs/Crores digit grouping, and multi-format transaction timestamps.
          </p>
        </div>

        {/* 1-Click Evaluation Benchmark Banner */}
        <div
          className="p-6 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all"
          style={{
            background: "linear-gradient(135deg, rgba(46,74,56,0.22) 0%, rgba(180,135,90,0.12) 100%)",
            border: "1px solid rgba(180,135,90,0.35)",
            boxShadow: "0 4px 24px rgba(21,18,14,0.4)",
          }}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#B4875A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#EDE6D6]">
                Official Benchmark Evaluation Batch
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#2E4A38] text-[#EDE6D6]">
                71 Records · 15 Chaos Cases
              </span>
            </div>
            <p className="text-xs text-[#A69A85] leading-relaxed max-w-xl">
              Instant 1-click execution: loads synthetic current-account bank statements, GST/TDS invoices, and ground-truth labels to test all 15 scenarios and compute verified precision &amp; recall.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLoadSample}
            disabled={loadingSample || loading}
            className="btn-primary-forest text-xs px-5 py-3 rounded-xl shrink-0 cursor-pointer disabled:opacity-50 flex items-center gap-2 shadow-lg"
          >
            {loadingSample ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-[#EDE6D6] border-t-transparent animate-spin" />
                <span>Loading Batch…</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Evaluation Batch</span>
              </>
            )}
          </button>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          style={{
            backgroundColor: "#1D1812",
            border: "1px solid rgba(180, 135, 90, 0.25)",
            borderRadius: "16px",
            boxShadow: "0 4px 24px rgba(21, 18, 14, 0.6)",
          }}
          className="space-y-8 p-8 sm:p-10 relative z-10"
        >
          {/* Merchant Identifier */}
          <div className="space-y-2.5">
            <label
              style={{
                color: "#A69A85",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
              className="block"
            >
              MERCHANT / ENTERPRISE ENTITY ID
            </label>
            <input
              type="text"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              style={{
                backgroundColor: "#15120E",
                border: "1px solid rgba(180, 135, 90, 0.3)",
                color: "#EDE6D6",
                borderRadius: "8px",
                fontFamily: "var(--font-mono)",
                padding: "0.75rem 1rem",
              }}
              className="w-full text-sm placeholder:text-[#A69A85] focus:border-[#B4875A] focus:outline-none transition-all"
              placeholder="e.g. MER-001"
            />
          </div>

          {/* Bank CSV File Input */}
          <FileInput
            label="BANK STATEMENT CSV"
            hint="txn_id, txn_date, amount, direction, narration, channel, reference_number"
            onChange={setBankFile}
            accept=".csv"
          />

          {/* Invoice CSV File Input */}
          <FileInput
            label="INVOICE REGISTER CSV"
            hint="invoice_id, invoice_date, counterparty_name, base_amount, total_amount, tds_section, tds_amount"
            onChange={setInvFile}
            accept=".csv"
          />

          {/* Optional Ground Truth CSV Input */}
          <FileInput
            label="GROUND TRUTH LABELS CSV (OPTIONAL — FOR EVALUATION)"
            hint="invoice_id, txn_ids, is_true_match, case_category — required to compute Precision/Recall"
            onChange={setGtFile}
            accept=".csv"
          />

          {error && (
            <div className="p-4 rounded-lg bg-[#251E16] border border-[#A34C3F]/50 text-[#EDE6D6] text-xs font-mono flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-[#A34C3F] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              backgroundColor: "#2E4A38",
              color: "#EDE6D6",
              border: "1px solid rgba(180, 135, 90, 0.35)",
              boxShadow: "0 0 0 1px rgba(46,74,56,0.4), 0 4px 24px -8px rgba(46,74,56,0.5)",
              borderRadius: "9999px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.12em",
            }}
            className="w-full py-4 text-xs font-semibold uppercase flex items-center justify-center gap-2.5 hover:bg-[#375743] hover:border-[#B4875A] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all duration-200"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-[#EDE6D6] border-t-transparent animate-spin" />
                <span>Ingesting CSV &amp; Initializing Kuhn-Munkres Matrix…</span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span>Execute 5-Pass Autonomous Pipeline</span>
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              </span>
            )}
          </button>
        </form>

        {/* Parse errors banner */}
        {parseErrors.length > 0 && (
          <div className="bg-[#1D1812] border border-[#C79A45]/40 rounded-2xl p-6 space-y-3 font-mono">
            <div className="flex items-center gap-2 text-[#C79A45] text-sm font-bold">
              <AlertCircle className="w-4 h-4" />
              <span>{parseErrors.length} rows flagged with parsing anomalies</span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 bg-[#15120E] rounded-lg p-3.5 border border-[rgba(180,135,90,0.2)] text-[11px] text-[#A69A85]">
              {parseErrors.slice(0, 20).map((e, i) => (
                <div key={i}>{JSON.stringify(e.errors)}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FileInput({
  label,
  hint,
  onChange,
  accept,
}: {
  label: string;
  hint: string;
  onChange: (f: File | null) => void;
  accept: string;
}) {
  const [name, setName] = useState<string | null>(null);

  return (
    <div className="space-y-2.5">
      <label
        style={{
          color: "#A69A85",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
        className="block"
      >
        {label}
      </label>
      <label className="block cursor-pointer group">
        <div
          style={{
            backgroundColor: name ? "rgba(46, 74, 56, 0.2)" : "#1D1812",
            border: name
              ? "1px solid rgba(60, 107, 76, 0.6)"
              : "1px dashed rgba(180, 135, 90, 0.4)",
            borderRadius: "10px",
            padding: "1.5rem 1.25rem",
          }}
          className="text-center transition-all group-hover:border-[#B4875A]"
        >
          {name ? (
            <div className="flex items-center justify-center gap-2 text-[#EDE6D6] text-sm font-medium">
              <CheckCircle2 className="w-5 h-5 text-[#3C6B4C]" />
              <span className="font-mono text-xs font-bold text-[#EDE6D6]">{name}</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <UploadCloud
                style={{ color: "#B4875A" }}
                className="w-7 h-7 mx-auto transition-transform group-hover:scale-110"
              />
              <p
                style={{
                  color: "#EDE6D6",
                  fontWeight: 500,
                  fontSize: "13px",
                }}
                className="font-body"
              >
                Click to select or drag &amp; drop CSV file
              </p>
              <p
                style={{
                  color: "#A69A85",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                }}
              >
                {hint}
              </p>
            </div>
          )}
        </div>
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setName(f?.name ?? null);
            onChange(f);
          }}
        />
      </label>
    </div>
  );
}
