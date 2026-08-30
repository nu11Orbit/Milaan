"use client";
// app/batches/[batchId]/settings/page.tsx — Modern FinTech Confidence Threshold Configuration

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getThresholds, updateThresholds } from "@/lib/api";
import { Sliders, ArrowLeft, Check } from "lucide-react";

export default function SettingsPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const [autoAccept, setAutoAccept] = useState(85);
  const [review, setReview] = useState(50);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getThresholds()
      .then((t) => {
        setAutoAccept(t.threshold_auto_accept);
        setReview(t.threshold_review);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    await updateThresholds(autoAccept, review);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <Loading />;

  return (
    <div className="max-w-xl space-y-6 mx-auto py-2">
      <div className="space-y-2">
        <Link
          href={`/batches/${batchId}/results`}
          className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-400 hover:text-emerald-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Ledger Results</span>
        </Link>

        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400">
            <Sliders className="w-3.5 h-3.5" />
            <span>Engine Hyperparameters</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mt-1">Confidence Thresholds</h1>
          <p className="text-slate-400 text-xs font-mono mt-0.5">
            Dynamically adjust decision bands for live evaluation. Changes apply immediately to subsequent pipeline runs.
          </p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-8 space-y-8 border border-white/10 shadow-2xl">
        <Slider
          label="Auto-Accept Floor"
          value={autoAccept}
          onChange={setAutoAccept}
          description="Matches scoring at or above this threshold are accepted automatically without human review."
          color="#10B981"
        />

        <Slider
          label="Review Floor"
          value={review}
          onChange={setReview}
          description="Scores between this floor and auto-accept are routed to human controller review."
          color="#F59E0B"
        />

        {/* Live Band Preview */}
        <div className="space-y-2.5 pt-4 border-t border-white/[0.08]">
          <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
            Active Band Partitions
          </p>
          <div className="flex flex-wrap gap-2 text-xs font-mono font-bold">
            <span className="band-auto px-3.5 py-1 rounded-full">
              Auto-Accept ≥ {autoAccept}
            </span>
            <span className="band-review px-3.5 py-1 rounded-full">
              Review {review}–{autoAccept - 1}
            </span>
            <span className="band-reject px-3.5 py-1 rounded-full">
              Exception &lt; {review}
            </span>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full btn-primary-glow py-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg"
        >
          {saved ? (
            <span className="flex items-center gap-1.5 text-slate-950 font-extrabold">
              <Check className="w-4 h-4" />
              <span>Applied to Live Engine</span>
            </span>
          ) : (
            <span>Apply Dynamic Thresholds</span>
          )}
        </button>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  description,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  description: string;
  color: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-xs font-mono uppercase tracking-wider text-slate-200 font-bold">{label}</label>
        <span className="text-2xl font-extrabold font-mono tabular-nums" style={{ color }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer border border-white/10"
        style={{ accentColor: color }}
      />
      <p className="text-slate-400 text-xs font-sans">{description}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="h-64 flex items-center justify-center space-y-2 flex-col">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      <span className="text-xs font-mono text-slate-400">Loading Configuration…</span>
    </div>
  );
}
