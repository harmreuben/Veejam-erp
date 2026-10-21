"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** Shows a toast once per action result (keyed on `at`). */
export function useResultToast(result: { ok: boolean; message?: string; at?: number }) {
  const shown = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!result.at || result.at === shown.current || !result.message) return;
    shown.current = result.at;
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  }, [result]);
}
