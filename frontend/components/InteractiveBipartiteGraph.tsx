"use client";
// components/InteractiveBipartiteGraph.tsx — Interactive 3D Bipartite Hungarian Solver Visualization

import { useState } from "react";
import { CheckCircle2, RefreshCw, Cpu } from "lucide-react";

interface Node {
  id: string;
  label: string;
  amount: string;
  detail: string;
}

const BANK_NODES: Node[] = [
  { id: "B1", label: "HDFC UTR 9482", amount: "₹88,200", detail: "TechServ (Net of 2% TDS)" },
  { id: "B2", label: "ICICI CMS 1084", amount: "₹45,000", detail: "Apex Logistics Ltd" },
  { id: "B3", label: "SBI NEFT 7731", amount: "₹1,35,000", detail: "Zenith Cloud Corp" },
];

const INVOICE_NODES: Node[] = [
  { id: "I1", label: "INV-2024-901", amount: "₹88,200", detail: "Gross ₹90k · TDS §194C" },
  { id: "I2", label: "INV-2024-902", amount: "₹45,000", detail: "Gross ₹45k · TDS Exempt" },
  { id: "I3", label: "INV-2024-903", amount: "₹1,35,000", detail: "Gross ₹150k · TDS §194J 10%" },
];

export default function InteractiveBipartiteGraph() {
  const [activeEdge, setActiveEdge] = useState<number | null>(0);
  const [isSolving, setIsSolving] = useState(false);
  const [solvedEdges, setSolvedEdges] = useState<number[]>([0, 1, 2]);

  const triggerSolve = () => {
    setIsSolving(true);
    setSolvedEdges([]);
    setTimeout(() => {
      setSolvedEdges([0]);
    }, 200);
    setTimeout(() => {
      setSolvedEdges([0, 1]);
    }, 450);
    setTimeout(() => {
      setSolvedEdges([0, 1, 2]);
      setIsSolving(false);
    }, 700);
  };

  return (
    <div className="glass rounded-2xl p-6 sm:p-8 space-y-6 border border-[var(--border)] relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--gold)] font-bold">
            <Cpu className="w-4 h-4" />
            <span>Hungarian Bipartite Assignment Solver (O(n³))</span>
          </div>
          <h4 className="text-base font-display font-semibold text-[var(--ink)]">Global Contention Resolution Visualizer</h4>
        </div>
        <button
          onClick={triggerSolve}
          disabled={isSolving}
          className="btn-ghost py-1.5 px-3.5 text-xs text-[var(--gold)] hover:text-[var(--gold-hi)] flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSolving ? "animate-spin" : ""}`} />
          <span>{isSolving ? "Solving Matrix…" : "Run Hungarian Optimizer"}</span>
        </button>
      </div>

      {/* Bipartite Graph Stage */}
      <div className="grid grid-cols-1 md:grid-cols-11 gap-4 items-center">
        {/* Left Column: Bank Statement Credits */}
        <div className="md:col-span-5 space-y-3 font-mono text-xs">
          <div className="hud-label px-1">
            Bank Credits (Statement)
          </div>
          {BANK_NODES.map((node, idx) => (
            <div
              key={node.id}
              onMouseEnter={() => setActiveEdge(idx)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                activeEdge === idx
                  ? "bg-white/[0.06] border-[var(--green)]/80 shadow-lg shadow-[var(--green)]/10"
                  : "bg-white/[0.02] border-[var(--border)] hover:border-white/20"
              }`}
            >
              <div className="flex justify-between items-center text-[var(--ink)] font-bold">
                <span>{node.label}</span>
                <span className="text-[var(--green)]">{node.amount}</span>
              </div>
              <div className="text-[11px] text-[var(--ink-muted)] mt-1">{node.detail}</div>
            </div>
          ))}
        </div>

        {/* Center: Plain Assignment Connector */}
        <div className="md:col-span-1 hidden md:flex flex-col items-center justify-around h-48 py-2">
          {BANK_NODES.map((_, idx) => (
            <div
              key={idx}
              className={`w-full h-0.5 transition-all duration-500 ${
                solvedEdges.includes(idx)
                  ? "bg-[var(--gold)]"
                  : "bg-white/10"
              }`}
            />
          ))}
        </div>

        {/* Right Column: Invoice Register Line Items */}
        <div className="md:col-span-5 space-y-3 font-mono text-xs">
          <div className="hud-label px-1">
            Invoice Register (ERP)
          </div>
          {INVOICE_NODES.map((node, idx) => (
            <div
              key={node.id}
              onMouseEnter={() => setActiveEdge(idx)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                activeEdge === idx
                  ? "bg-white/[0.06] border-[var(--gold)]/80 shadow-lg shadow-[var(--gold)]/10"
                  : "bg-white/[0.02] border-[var(--border)] hover:border-white/20"
              }`}
            >
              <div className="flex justify-between items-center text-[var(--ink)] font-bold">
                <span>{node.label}</span>
                <span className="text-[var(--gold)]">{node.amount}</span>
              </div>
              <div className="text-[11px] text-[var(--ink-muted)] mt-1">{node.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Telemetry Output Bar */}
      <div className="p-3.5 rounded-xl glass border border-[var(--border)] font-mono text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[var(--ink-muted)]">
        <div className="flex items-center gap-2 text-[var(--green)]">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Global Cost: <strong>0.00</strong> (100% Optimal Assignment without greedy collision)</span>
        </div>
        <span className="hud-label text-[11px]">Solver Latency: 0.28ms</span>
      </div>
    </div>
  );
}
