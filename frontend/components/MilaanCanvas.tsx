"use client";
// MilaanCanvas.tsx — Re-exporting the dynamic 3D Scrollytelling engine
import dynamic from "next/dynamic";

const Milaan3DScrollytelling = dynamic(
  () => import("./Milaan3DScrollytelling"),
  { ssr: false }
);

export default function MilaanCanvas() {
  return <Milaan3DScrollytelling />;
}
