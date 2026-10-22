"use client";

import { useEffect, useState } from "react";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** Round trips from this browser to the app's servers (no database, no sign-in). */
export function BrowserTiming() {
  const [times, setTimes] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: number[] = [];
      try {
        for (let i = 0; i < 5; i++) {
          const t = performance.now();
          await fetch(`/api/health?t=${Date.now()}`, { cache: "no-store" });
          out.push(Math.round(performance.now() - t));
        }
        if (!cancelled) setTimes(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed)
    return <p className="text-destructive text-sm">Couldn&apos;t reach the server from this browser.</p>;
  if (!times) return <p className="text-muted-foreground text-sm">Measuring…</p>;
  const typical = median(times.slice(1));
  return (
    <div className="bg-card grid gap-1 rounded-lg border p-4 text-sm">
      <p>
        A round trip from this device to the app takes about{" "}
        <strong className="tabular-nums">{typical} ms</strong>
        {typical > 600
          ? ": slow. The internet connection here (or mobile data) is the main delay."
          : typical > 300
            ? ": usual for Kenya to Europe on mobile data."
            : ": good."}
      </p>
      <p className="text-muted-foreground text-xs">
        Five tries: {times.join(", ")} ms. Each click needs at least one.
      </p>
    </div>
  );
}
