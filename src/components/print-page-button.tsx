"use client";

export function PrintPageButton({ label = "Print or save as PDF" }: { label?: string }) {
  return <button className="button primary" onClick={() => window.print()} type="button">{label}</button>;
}
