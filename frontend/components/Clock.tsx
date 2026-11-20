"use client";
import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

const TZ = "Asia/Ho_Chi_Minh";
const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const date = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short", year: "numeric" });

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
  return (
    <div className="flex items-center gap-2 whitespace-nowrap tabular-nums" title="Vietnam time (GMT+7)" aria-label="Current time in Vietnam">
      <Clock3 className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden />
      <span className="min-w-[4.5rem] text-sm font-semibold text-slate-100">{d ? time.format(d) : "--:--:--"}</span>
      <span className="hidden text-xs text-slate-400 sm:inline">{d ? date.format(d) : ""} · GMT+7</span>
    </div>
  );
}
