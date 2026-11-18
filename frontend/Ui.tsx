"use client";
import { BASE } from "@/lib/data";

export function ConfigWarning() {
  if (BASE) return null;
  return (
    <div className="rounded border border-amber-600 bg-amber-950 p-3 text-sm text-amber-200">
      Set <code>NEXT_PUBLIC_DATA_BASE_URL</code> (e.g. https://raw.githubusercontent.com/OWNER/REPO/main/data) in Vercel → Project → Environment Variables.
    </div>
  );
}
export const Page = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <main className="mx-auto max-w-7xl space-y-4 p-4">
    <h1 className="text-xl font-semibold text-white">{title}</h1>
    <ConfigWarning />
    {children}
  </main>
);
export const Loading = ({ what }: { what: string }) => <p className="text-sm text-slate-500">Loading {what}…</p>;
