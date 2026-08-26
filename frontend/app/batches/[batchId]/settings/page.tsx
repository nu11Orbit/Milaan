"use client";
// app/batches/[batchId]/settings/page.tsx — Live threshold sliders

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getThresholds, updateThresholds } from "@/lib/api";

export default function SettingsPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const [autoAccept, setAutoAccept] = useState(85);
  const [review,     setReview]     = useState(50);
  const [saved,      setSaved]      = useState(false);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    getThresholds().then(t => {
      setAutoAccept(t.threshold_auto_accept);
      setReview(t.threshold_review);
    }).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    await updateThresholds(autoAccept, review);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-slate-400 animate-pulse">Loading…</p>;

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Confidence Thresholds</h1>
        <p className="text-slate-400 text-sm mt-1">
          Adjust in-process for demo purposes. Changes take effect on the next run.
          To persist, update <code className="text-blue-400">.env</code>.
        </p>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-8">
        <Slider
          label="Auto-Accept Threshold"
          value={autoAccept}
          onChange={setAutoAccept}
          description="Records scoring ≥ this are auto-accepted without human review."
          color="#22c55e"
        />
        <Slider
          label="Review Threshold"
          value={review}
          onChange={setReview}
          description="Records scoring between this and auto-accept threshold go to the review queue."
          color="#f59e0b"
        />

        {/* Band preview */}
        <div className="space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Band Preview</p>
          <div className="flex gap-2 text-xs">
            <span className="band-auto px-2 py-1 rounded-full text-xs">Auto-accept ≥ {autoAccept}</span>
            <span className="band-review px-2 py-1 rounded-full text-xs">Review {review}–{autoAccept - 1}</span>
            <span className="band-reject px-2 py-1 rounded-full text-xs">Exception &lt; {review}</span>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          {saved ? "✓ Saved" : "Apply Thresholds"}
        </button>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, description, color }: {
  label: string; value: number; onChange: (v: number) => void;
  description: string; color: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-white">{label}</label>
        <span className="text-2xl font-bold font-mono" style={{ color }}>{value}</span>
      </div>
      <input
        type="range" min={0} max={100} step={1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
        style={{ accentColor: color }}
      />
      <p className="text-slate-500 text-xs">{description}</p>
    </div>
  );
}
