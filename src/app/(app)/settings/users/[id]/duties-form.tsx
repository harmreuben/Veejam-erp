"use client";

import { Lock, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { SubmitBar, useActionForm } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { saveDuties } from "../actions";

export type DutyItem = {
  key: string;
  label: string;
  group: string;
  /** Duty it depends on, if any. */
  requires: string | null;
  /** Only comes with a role (can't be switched on here). */
  roleOnly: boolean;
};

/**
 * Tick boxes for one person's duties, grouped by area.
 * Ticking a duty also ticks what it needs; unticking one also unticks what
 * depends on it, so the list is always consistent. The server checks again.
 */
export function DutiesForm({
  userId,
  name,
  roleLabel,
  duties,
  groups,
  effective,
  roleDefaults,
  editable,
}: {
  userId: string;
  name: string;
  roleLabel: string;
  duties: DutyItem[];
  groups: string[];
  effective: string[];
  roleDefaults: string[];
  editable: boolean;
}) {
  const { state, submit, pending, errors } = useActionForm(saveDuties);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(effective));
  const defaults = useMemo(() => new Set(roleDefaults), [roleDefaults]);
  const byKey = useMemo(() => new Map(duties.map((d) => [d.key, d])), [duties]);

  const dependents = (key: string): string[] => {
    const out: string[] = [];
    for (const d of duties) if (d.requires === key) out.push(d.key, ...dependents(d.key));
    return out;
  };
  const toggle = (key: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) {
        let cur: string | null = key;
        while (cur) {
          next.add(cur);
          cur = byKey.get(cur)?.requires ?? null;
        }
      } else {
        next.delete(key);
        for (const d of dependents(key)) next.delete(d);
      }
      return next;
    });
  };

  const added = [...checked].filter((k) => !defaults.has(k));
  const removed = [...defaults].filter((k) => !checked.has(k));
  const customised = added.length + removed.length > 0;

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <input type="hidden" name="userId" value={userId} />
      {[...checked].map((k) => (
        <input key={k} type="hidden" name="permissions" value={k} />
      ))}

      <div className="flex flex-wrap items-center gap-3 text-sm" aria-live="polite">
        {customised ? (
          <>
            <Badge variant="warning">Customised</Badge>
            <span className="text-muted-foreground">
              {added.length > 0 && `${added.length} more than a ${roleLabel}`}
              {added.length > 0 && removed.length > 0 && " · "}
              {removed.length > 0 && `${removed.length} fewer than a ${roleLabel}`}
            </span>
            {editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setChecked(new Set(roleDefaults))}
              >
                <RotateCcw className="size-4" aria-hidden />
                Back to {roleLabel} defaults
              </Button>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Same as every {roleLabel}.</span>
        )}
      </div>

      {errors("permissions")?.map((m) => (
        <p key={m} role="alert" className="text-destructive text-sm">
          {m}
        </p>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <fieldset key={group} className="bg-card grid content-start gap-1 rounded-lg border p-4">
            <legend className="sr-only">{group}</legend>
            <h2 className="mb-2 text-sm font-semibold" aria-hidden>
              {group}
            </h2>
            {duties
              .filter((d) => d.group === group)
              .map((d) => {
                const on = checked.has(d.key);
                const locked = !editable || (d.roleOnly && !defaults.has(d.key) && !on);
                const changed = on !== defaults.has(d.key);
                return (
                  <label
                    key={d.key}
                    className={`flex items-start gap-3 rounded-md px-2 py-1.5 text-sm ${
                      locked ? "text-muted-foreground" : "hover:bg-muted/60 cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-primary mt-0.5 size-4 shrink-0"
                      checked={on}
                      disabled={locked}
                      onChange={(e) => toggle(d.key, e.target.checked)}
                    />
                    <span className="grid gap-0.5">
                      <span>
                        {d.label}
                        {changed && (
                          <span className="text-warning ml-2 text-xs font-medium">
                            {on ? "added" : "removed"}
                          </span>
                        )}
                      </span>
                      {d.roleOnly && !defaults.has(d.key) && (
                        <span className="flex items-center gap-1 text-xs">
                          <Lock className="size-3" aria-hidden />
                          Comes only with a role
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
          </fieldset>
        ))}
      </div>

      {editable && (
        <SubmitBar pending={pending} state={state} label="Save duties" pendingLabel="Saving…">
          <span className="text-muted-foreground text-sm">
            {name} gets the new duties on their next click.
          </span>
        </SubmitBar>
      )}
    </form>
  );
}
