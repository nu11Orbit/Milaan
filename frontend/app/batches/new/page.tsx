"use client";
// app/batches/new/page.tsx — CSV upload form

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadBatch, triggerRun } from "@/lib/api";

export default function NewBatchPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState("MER-001");
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [invFile, setInvFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<any[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bankFile || !invFile) { setError("Both CSV files are required."); return; }
    setLoading(true); setError(null); setParseErrors([]);
    try {
      const fd = new FormData();
      fd.append("merchant_id", merchantId);
      fd.append("bank_csv", bankFile);
      fd.append("invoice_csv", invFile);
      const batch = await uploadBatch(fd);
      if (batch.parse_errors?.length) setParseErrors(batch.parse_errors);
      // Trigger run immediately
      const run = await triggerRun(batch.batch_id);
      router.push(`/batches/${batch.batch_id}/run?runId=${run.run_id}`);
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">New Reconciliation Batch</h1>
        <p className="text-slate-400 text-sm mt-1">
          Upload your bank statement CSV and invoice register CSV.
          Supports ₹ symbol, Indian digit grouping, and DD-MM-YYYY dates.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
        {/* Merchant ID */}
        <div>
          <label className="block text-sm text-slate-300 mb-1">Merchant ID</label>
          <input
            type="text" value={merchantId} onChange={e => setMerchantId(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Bank CSV */}
        <FileInput
          label="Bank Statement CSV"
          hint="Columns: txn_id, txn_date, amount, direction, narration, channel, reference_number"
          onChange={setBankFile}
          accept=".csv"
        />

        {/* Invoice CSV */}
        <FileInput
          label="Invoice Register CSV"
          hint="Columns: invoice_id, invoice_date, counterparty_name, base_amount, total_amount, tds_section, tds_amount"
          onChange={setInvFile}
          accept=".csv"
        />

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          {loading ? "Uploading & Starting Run…" : "Upload & Run Reconciliation →"}
        </button>
      </form>

      {/* Parse errors */}
      {parseErrors.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 space-y-2">
          <p className="text-amber-300 text-sm font-medium">{parseErrors.length} rows skipped (parse errors)</p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {parseErrors.slice(0, 20).map((e, i) => (
              <div key={i} className="text-amber-400/70 text-xs font-mono">{JSON.stringify(e.errors)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FileInput({ label, hint, onChange, accept }: {
  label: string; hint: string;
  onChange: (f: File | null) => void; accept: string;
}) {
  const [name, setName] = useState<string | null>(null);
  return (
    <div>
      <label className="block text-sm text-slate-300 mb-1">{label}</label>
      <label className="block cursor-pointer">
        <div className="border-2 border-dashed border-slate-700 hover:border-blue-600 rounded-lg px-4 py-6 text-center transition-colors">
          {name
            ? <p className="text-green-400 text-sm">✓ {name}</p>
            : <p className="text-slate-500 text-sm">Click to select or drop a CSV file</p>
          }
        </div>
        <input type="file" accept={accept} className="hidden" onChange={e => {
          const f = e.target.files?.[0] ?? null;
          setName(f?.name ?? null);
          onChange(f);
        }} />
      </label>
      <p className="text-slate-600 text-xs mt-1">{hint}</p>
    </div>
  );
}
