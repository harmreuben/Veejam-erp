import * as React from "react";

import { Illustration, type ArtName } from "@/components/illustrations";
import { cn } from "@/lib/utils";

/** A plain, accessible data table that scrolls sideways on phones instead of squashing. */
export function Table({
  className,
  minWidth = 640,
  ...props
}: React.ComponentProps<"table"> & { minWidth?: number }) {
  return (
    <div className="bg-card overflow-x-auto rounded-lg border">
      <table className={cn("w-full text-sm", className)} style={{ minWidth }} {...props} />
    </div>
  );
}

export function THead(props: React.ComponentProps<"thead">) {
  return <thead className="text-muted-foreground border-b text-left text-xs" {...props} />;
}

export function TBody(props: React.ComponentProps<"tbody">) {
  return <tbody className="divide-y" {...props} />;
}

export function TH({ className, numeric, ...props }: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-2.5 font-medium whitespace-nowrap", numeric && "text-right", className)}
      {...props}
    />
  );
}

export function TD({ className, numeric, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn("px-4 py-2.5 align-top", numeric && "text-right whitespace-nowrap", className)}
      {...props}
    />
  );
}

/** "Nothing here yet" across the whole table, with an optional drawing above the words. */
export function EmptyRow({
  colSpan,
  art,
  children,
}: {
  colSpan: number;
  art?: ArtName;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-muted-foreground px-4 py-10 text-center">
        {art ? (
          <div className="vj-page flex flex-col items-center gap-3">
            <Illustration name={art} />
            <div>{children}</div>
          </div>
        ) : (
          children
        )}
      </td>
    </tr>
  );
}
