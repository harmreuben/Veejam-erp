import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Label + control + hint/error, wired for screen readers:
 * the control gets aria-describedby and aria-invalid automatically.
 */
export function Field({
  id,
  label,
  hint,
  errors,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {React.cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": errors?.length ? true : undefined,
      })}
      {hint && !errors?.length && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {errors?.length ? (
        <p id={errorId} className="text-destructive text-xs" role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
