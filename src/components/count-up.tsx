"use client";

import { useEffect, useState } from "react";

import { formatKES } from "@/lib/money";

// Set once the app has started in this tab. Before that (the first page drawn
// by the server), figures show straight away; after it (moving to a page inside
// the app), they count up. That way a number never flashes back to zero.
let appStarted = false;
export function markAppStarted() {
  appStarted = true;
}

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A KES amount (or a whole number) that counts up from zero when its page opens. */
export function CountUp({ value, kind = "kes" }: { value: string | number; kind?: "kes" | "count" }) {
  const target = Number(value);
  const format = (n: number) => (kind === "kes" ? formatKES(n.toFixed(2)) : String(Math.round(n)));
  const [shown, setShown] = useState<number>(() =>
    typeof window !== "undefined" && appStarted && !reduceMotion() && Number.isFinite(target) ? 0 : target,
  );

  useEffect(() => {
    if (shown === target || !Number.isFinite(target)) return;
    const start = performance.now();
    const duration = 600;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t === 1 ? target : target * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Only when the figure itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Screen readers get the real figure, not every step on the way.
  return (
    <>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(target)}</span>
    </>
  );
}

/** Rendered once in the app's layout: marks the app as started after the first page is up. */
export function AppStarted() {
  useEffect(() => {
    markAppStarted();
  }, []);
  return null;
}
