import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const selectClass =
  "border-input bg-card focus-visible:ring-ring/40 h-9 w-full min-w-0 rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px] disabled:opacity-60";

/**
 * A search box with optional dropdown filters. A plain GET form: works without
 * JavaScript and the result has a shareable URL.
 */
export function FilterBar({
  q,
  placeholder,
  selects = [],
  checkbox,
}: {
  q?: string;
  placeholder: string;
  selects?: { name: string; label: string; value?: string; options: { value: string; label: string }[] }[];
  checkbox?: { name: string; label: string; checked: boolean };
}) {
  return (
    <form method="get" role="search" className="flex flex-wrap items-end gap-2">
      <label className="grid min-w-[14rem] flex-1 gap-1">
        <span className="sr-only">Search</span>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4"
            aria-hidden
          />
          <Input name="q" type="search" defaultValue={q} placeholder={placeholder} className="pl-8" />
        </div>
      </label>
      {selects.map((s) => (
        <label key={s.name} className="grid gap-1">
          <span className="text-muted-foreground text-xs">{s.label}</span>
          <select name={s.name} defaultValue={s.value} className={selectClass}>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {checkbox && (
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={checkbox.name}
            value="1"
            defaultChecked={checkbox.checked}
            className="size-4"
          />
          {checkbox.label}
        </label>
      )}
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}

export const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "ALL", label: "All" },
];

/** Read a single string search param. */
export function param(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
