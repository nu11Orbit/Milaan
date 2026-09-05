"use client";
// app/batches/[batchId]/settings/page.tsx — Confidence Threshold Configuration

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
    <div className="max-w-xl space-y-6 mx-auto pt-28 pb-16 px-4">
      <div className="space-y-2">
        <Link
          href={`/batches/${batchId}/results`}
          className="inline-flex items-center gap-1.5 text-xs font-mono transition-colors hover:underline"
          style={{ color: "#A69A85" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Ledger Results</span>
        </Link>

        <div>
          <div
            className="inline-flex items-center gap-1.5 text-xs font-mono"
            style={{ color: "#B4875A" }}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Engine Hyperparameters</span>
          </div>
          <h1
            className="text-3xl font-extrabold tracking-tight mt-1"
            style={{ color: "#EDE6D6", fontFamily: "var(--font-display)" }}
          >
            Confidence Thresholds
          </h1>
          <p className="text-xs font-mono mt-0.5" style={{ color: "#A69A85" }}>
            Dynamically adjust decision bands for live evaluation. Changes apply immediately to subsequent pipeline runs.
          </p>
        </div>
      </div>

      <div
        className="glass-panel rounded-2xl p-8 space-y-8 shadow-2xl"
        style={{ border: "1px solid rgba(237,230,214,0.1)" }}
      >
        <Slider
          label="Auto-Accept Floor"
          value={autoAccept}
          onChange={setAutoAccept}
          description="Matches scoring at or above this threshold are accepted automatically without human review."
          color="#7AAE88"
        />

        <Slider
          label="Review Floor"
          value={review}
          onChange={setReview}
          description="Scores between this floor and auto-accept are routed to human controller review."
          color="#C79A45"
        />

        {/* Live Band Preview */}
        <div
          className="space-y-2.5 pt-4"
          style={{ borderTop: "1px solid rgba(237,230,214,0.08)" }}
        >
          <p className="text-[11px] font-mono uppercase tracking-wider font-semibold" style={{ color: "#A69A85" }}>
            Active Band Partitions
          </p>
          <div className="flex flex-wrap gap-2 text-xs font-mono font-bold">
            <span
              className="px-3.5 py-1 rounded-full"
              style={{ background: "rgba(60,107,76,0.15)", color: "#7AAE88", border: "1px solid rgba(60,107,76,0.35)" }}
            >
              Auto-Accept ≥ {autoAccept}
            </span>
            <span
              className="px-3.5 py-1 rounded-full"
              style={{ background: "rgba(199,154,69,0.15)", color: "#C79A45", border: "1px solid rgba(199,154,69,0.35)" }}
            >
              Review {review}–{autoAccept - 1}
            </span>
            <span
              className="px-3.5 py-1 rounded-full"
              style={{ background: "rgba(163,76,63,0.15)", color: "#C06050", border: "1px solid rgba(163,76,63,0.35)" }}
            >
              Exception &lt; {review}
            </span>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full btn-primary-glow py-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
        >
          {saved ? (
            <span className="flex items-center gap-1.5 font-extrabold" style={{ color: "#15120E" }}>
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
        <label className="text-xs font-mono uppercase tracking-wider font-bold" style={{ color: "#EDE6D6" }}>
          {label}
        </label>
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
        className="w-full h-2 rounded-lg appearance-none cursor-pointer"
        style={{
          background: "#15120E",
          border: "1px solid rgba(237,230,214,0.1)",
          accentColor: color,
        }}
      />
      <p className="text-[11px] font-sans" style={{ color: "#A69A85" }}>{description}</p>
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
        Loading Thresholds…
      </span>
    </div>
  );
}
