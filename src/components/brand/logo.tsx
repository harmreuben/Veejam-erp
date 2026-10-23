import { cn } from "@/lib/utils";

/** Brand colours, also used for the installed-app icons in public/icons. */
export const BRAND = { green: "#0b6e5b", amber: "#f0b54a", white: "#ffffff" } as const;

/** The VJ monogram's strokes on a 64×64 grid: a white V, and an amber J hooking under it. */
const MARK_V = "M13.5 17 L25 45 L36.5 17";
const MARK_J = "M50.5 17 V37 Q50.5 48 41 48 Q37.5 48 35.5 45.5";

/**
 * The VeeJam mark. `tile="brand"` draws the green tile (sign-in, icons);
 * `tile="soft"` a faint tile for the green menu, where a green tile would vanish.
 */
export function LogoMark({ tile = "brand", className }: { tile?: "brand" | "soft"; className?: string }) {
  const stroke = { fill: "none", strokeWidth: 7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect
        width="64"
        height="64"
        rx="15"
        fill={tile === "brand" ? BRAND.green : BRAND.white}
        fillOpacity={tile === "brand" ? 1 : 0.12}
      />
      <path d={MARK_V} stroke={BRAND.white} {...stroke} />
      <path d={MARK_J} stroke={BRAND.amber} {...stroke} />
    </svg>
  );
}

/** Mark plus the company name, as used at the top of the menu and the sign-in page. */
export function Logo({
  name,
  tile = "soft",
  className,
}: {
  name: string;
  tile?: "brand" | "soft";
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark tile={tile} />
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-lg font-bold tracking-tight">{name}</span>
        <span className="text-sidebar-muted text-xs font-normal">ERP</span>
      </span>
    </span>
  );
}
