"use client";
import { BASE } from "@/lib/data";

export function ConfigWarning() {
  if (BASE) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      Set <code>NEXT_PUBLIC_DATA_BASE_URL</code> (e.g. https://raw.githubusercontent.com/OWNER/REPO/main/data) in Vercel → Project → Environment Variables.
    </div>
  );
}
export const Page = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <main className="mx-auto max-w-7xl space-y-4 p-4">
    <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
    <ConfigWarning />
    {children}
  </main>
);
export const Loading = ({ what }: { what: string }) => <p className="text-sm text-slate-500">Loading {what}…</p>;
