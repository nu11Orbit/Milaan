import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ReconAI — GST/TDS Reconciliation Engine",
  description: "AI-powered bank-to-invoice reconciliation for Indian SMEs. Razorpay AI Buildathon Track 04.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-[#0a0f1e] text-slate-100 min-h-screen`}>
        {/* ── Topnav ── */}
        <header className="border-b border-slate-800 bg-[#0d1326]/80 backdrop-blur sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 font-semibold text-white">
              <span className="text-blue-400 text-lg">⚡</span> ReconAI
            </Link>
            <nav className="flex items-center gap-6 text-sm text-slate-400">
              <Link href="/batches/new" className="hover:text-white transition-colors">New Batch</Link>
            </nav>
            <div className="ml-auto text-xs text-slate-600">
              Razorpay AI Buildathon · Track 04
            </div>
          </div>
        </header>

        {/* ── Page content ── */}
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
