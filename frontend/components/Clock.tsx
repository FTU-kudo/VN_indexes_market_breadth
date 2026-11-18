"use client";
import { useEffect, useState } from "react";

const TZ = "Asia/Ho_Chi_Minh";
const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const date = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short", year: "numeric" });

/** Live Vietnam time (GMT+7), independent of the visitor's own time zone. */
export default function Clock() {
  const [now, setNow] = useState<Date | null>(null); // null on the server / first paint avoids a hydration mismatch
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap tabular-nums" title="Vietnam time (GMT+7)" aria-label="Current time in Vietnam">
      <span className="min-w-[4.5rem] text-sm font-semibold text-slate-100">{now ? time.format(now) : "--:--:--"}</span>
      <span className="hidden text-xs text-slate-400 sm:inline">{now ? date.format(now) : ""} · GMT+7</span>
    </div>
  );
}
