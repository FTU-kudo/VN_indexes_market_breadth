// frontend/components/Clock.tsx
"use client";
import { useEffect, useState } from "react";

const TZ = "Asia/Ho_Chi_Minh";
const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const date = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
const vnParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function isMarketOpen(d: Date | null): boolean {
  if (!d) return false;
  const parts = Object.fromEntries(vnParts.formatToParts(d).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return (mins >= 9 * 60 && mins <= 11 * 60 + 30) || (mins >= 13 * 60 && mins <= 15 * 60);
}

/** Live Vietnam time (GMT+7). Ticks exactly on each whole second of the device clock, so it never lags or skips. */
export default function Clock() {
  const [now, setNow] = useState<number | null>(null); // null until mounted: avoids a server/client mismatch
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      timer = setTimeout(tick, 1000 - (t % 1000) + 2); // wake just after the next second boundary
    };
    const refresh = () => { if (document.visibilityState === "visible") { clearTimeout(timer); tick(); } }; // background tabs throttle timers
    tick();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  const d = now === null ? null : new Date(now);
  const open = isMarketOpen(d);
  return (
    <div
      className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-slate-700/80 bg-slate-950/90 px-3.5 py-1.5 shadow-sm"
      title={open ? "HOSE market session open · Vietnam time (GMT+7)" : "HOSE market closed · Vietnam time (GMT+7)"}
      aria-label="Current time in Vietnam"
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        {open && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${open ? "bg-emerald-500" : "bg-slate-400"}`} />
      </span>
      <span className="min-w-[4.25rem] text-xs font-bold tabular-nums text-slate-100 sm:text-sm">
        {d ? time.format(d) : "--:--:--"}
      </span>
      <span className="hidden h-3.5 w-px bg-slate-700 sm:block" aria-hidden />
      <span className="hidden text-xs font-medium text-slate-400 sm:inline">
        {d ? date.format(d) : ""}
      </span>
    </div>
  );
}
