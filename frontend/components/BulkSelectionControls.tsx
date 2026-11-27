// frontend/components/BulkSelectionControls.tsx
"use client";
import { CheckCheck, RotateCcw } from "lucide-react";

type Props = {
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isAllSelected?: boolean;
  isNoneSelected?: boolean;
};

export default function BulkSelectionControls({ onSelectAll, onDeselectAll, isAllSelected = false, isNoneSelected = false }: Props) {
  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onSelectAll}
        disabled={isAllSelected}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200/90 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 dark:border-blue-800/80 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-900/60"
      >
        <CheckCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Select all
      </button>
      <button
        type="button"
        onClick={onDeselectAll}
        disabled={isNoneSelected}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-sm transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 dark:hover:border-rose-800 dark:hover:bg-rose-950/50 dark:hover:text-rose-300"
      >
        <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Deselect all
      </button>
    </div>
  );
}
