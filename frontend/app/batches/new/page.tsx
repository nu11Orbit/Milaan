"use client";
// app/batches/new/page.tsx — Modern FinTech SaaS Batch Intake Portal

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadBatch, triggerRun } from "@/lib/api";
import { UploadCloud, AlertCircle, CheckCircle2, ArrowRight, FileSpreadsheet } from "lucide-react";

export default function NewBatchPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState("MER-001");
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [invFile, setInvFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<Array<{ errors: Record<string, string[]> }>>([]);

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
    <div className="max-w-2xl mx-auto space-y-8 py-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono text-emerald-400">
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>Batch Intake Portal</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">New Reconciliation Intake</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Upload your bank statement and invoice register. Indian format engine parses ₹ currency formats, Lakhs/Crores digit grouping, and multi-format transaction timestamps.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 glass-panel rounded-2xl p-8 border border-white/10 shadow-2xl">
        {/* Merchant Identifier */}
        <div className="space-y-2">
          <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
            Merchant / Enterprise ID
          </label>
          <input
            type="text"
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            className="w-full bg-slate-950/80 border border-white/10 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl px-4 py-3 text-sm text-slate-100 font-mono focus:outline-none transition-all"
            placeholder="e.g. MER-001"
          />
        </div>

        {/* Bank CSV File Input */}
        <FileInput
          label="Bank Statement CSV"
          hint="txn_id, txn_date, amount, direction, narration, channel, reference_number"
          onChange={setBankFile}
          accept=".csv"
        />

        {/* Invoice CSV File Input */}
        <FileInput
          label="Invoice Register CSV"
          hint="invoice_id, invoice_date, counterparty_name, base_amount, total_amount, tds_section, tds_amount"
          onChange={setInvFile}
          accept=".csv"
        />

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full btn-primary-glow py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-slate-900 border-t-transparent animate-spin" />
              <span>Ingesting CSV & Initializing 5-Pass Pipeline…</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span>Execute 5-Pass AI Pipeline</span>
              <ArrowRight className="w-4 h-4" />
            </span>
          )}
        </button>
      </form>

      {/* Parse errors banner */}
      {parseErrors.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 space-y-3 font-mono">
          <div className="flex items-center gap-2 text-amber-300 text-sm font-bold">
            <AlertCircle className="w-4 h-4" />
            <span>{parseErrors.length} rows flagged with parsing anomalies</span>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1 bg-slate-950 rounded-xl p-3.5 border border-white/5 text-[11px] text-amber-200/80">
            {parseErrors.slice(0, 20).map((e, i) => (
              <div key={i}>{JSON.stringify(e.errors)}</div>
            ))}
          </div>
        </div>
      )}
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
    <div className="space-y-2">
      <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">{label}</label>
      <label className="block cursor-pointer group">
        <div
          className={`border-2 border-dashed rounded-xl px-5 py-6 text-center transition-all ${
            name
              ? "border-emerald-500/60 bg-emerald-500/[0.06]"
              : "border-white/10 hover:border-emerald-500/50 bg-slate-950/50 hover:bg-slate-950/80"
          }`}
        >
          {name ? (
            <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-medium">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-mono text-xs">{name}</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <UploadCloud className="w-7 h-7 mx-auto text-slate-400 group-hover:text-emerald-400 transition-colors" />
              <p className="text-xs text-slate-300 font-medium">Click to select or drag & drop CSV</p>
              <p className="text-[11px] text-slate-500 font-mono">{hint}</p>
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
