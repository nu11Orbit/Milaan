import type { Metadata } from "next";
import Header from "@/components/Header";
import SmoothScrollProvider from "@/components/SmoothScrollProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Milaan — Autonomous Financial Reconciliation Prototype",
  description:
    "Autonomous Financial Reconciliation Prototype. Probabilistic Fellegi-Sunter scoring, Kuhn-Munkres Hungarian O(n³) optimal matching, and Benford's Law forensic auditing across synthetic Indian financial datasets.",
  keywords: [
    "financial reconciliation",
    "Kuhn-Munkres",
    "Fellegi-Sunter",
    "TDS reconciliation",
    "Indian financial modeling",
    "bipartite graph solver",
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,300;1,9..144,400;1,9..144,500&family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-screen flex flex-col bg-[#15120E] text-[#EDE6D6] antialiased">
        <SmoothScrollProvider>
          <Header />
          <main className="flex-1 w-full">{children}</main>
        </SmoothScrollProvider>
      </body>
    </html>
  );
}
