import { cn } from "@/lib/utils";

import { BRAND } from "./logo";

const stroke = {
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const soft = { ...stroke, fill: "currentColor", fillOpacity: 0.08 } as const;

/**
 * The sign-in page's drawing (original artwork): stock leaves the warehouse,
 * goes out on the van along the route, and reaches the shop. Drawn for the green
 * panel; the route's dashes drift gently unless reduced motion is on.
 */
export function SignInScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 230" aria-hidden className={cn("w-full", className)}>
      {/* Route from the warehouse to the shop. */}
      <path
        d="M76 92 Q210 0 352 112"
        fill="none"
        {...stroke}
        strokeOpacity={0.55}
        strokeDasharray="1 10"
        className="vj-route"
      />
      <path
        d="M352 92c-7 0-12 5-12 12 0 9 12 20 12 20s12-11 12-20c0-7-5-12-12-12z"
        fill={BRAND.amber}
        stroke="none"
      />
      <circle cx="352" cy="104" r="4" fill={BRAND.green} />

      {/* Ground. */}
      <path d="M12 206H388" {...stroke} strokeOpacity={0.35} />

      {/* Warehouse. */}
      <path d="M24 126 76 100l52 26v80H24z" {...soft} />
      <rect x="56" y="152" width="40" height="54" rx="2" {...soft} />
      <path d="M56 164h40M56 176h40M56 188h40" {...stroke} strokeOpacity={0.45} strokeWidth={2} />

      {/* Cartons. */}
      <rect x="136" y="178" width="28" height="28" rx="2" {...soft} />
      <rect x="166" y="178" width="28" height="28" rx="2" {...soft} />
      <rect x="151" y="148" width="28" height="28" rx="2" {...soft} />
      <path d="M150 178v8M180 178v8M165 148v8" {...stroke} stroke={BRAND.amber} strokeWidth={3} />

      {/* Van. */}
      <g>
        <rect x="206" y="152" width="72" height="42" rx="4" {...soft} />
        <path d="M278 164h22l14 16v14h-36z" fill={BRAND.amber} {...stroke} />
        <path d="M283 169h14l8 10h-22z" fill={BRAND.green} {...stroke} strokeWidth={2} />
        <path d="M218 172h28" {...stroke} stroke={BRAND.amber} strokeWidth={4} />
        <circle cx="226" cy="196" r="10" fill={BRAND.green} {...stroke} />
        <circle cx="294" cy="196" r="10" fill={BRAND.green} {...stroke} />
        <circle cx="226" cy="196" r="3" fill="currentColor" />
        <circle cx="294" cy="196" r="3" fill="currentColor" />
        <path d="M184 160h12M178 170h14" {...stroke} strokeOpacity={0.45} />
      </g>

      {/* Shop. */}
      <rect x="324" y="146" width="60" height="60" rx="2" {...soft} />
      <path
        d="M320 132h68v10q-4.25 6-8.5 0q-4.25 6-8.5 0q-4.25 6-8.5 0q-4.25 6-8.5 0q-4.25 6-8.5 0q-4.25 6-8.5 0q-4.25 6-8.5 0q-4.25 6-8.5 0z"
        fill="currentColor"
        fillOpacity={0.9}
        {...stroke}
      />
      <rect x="346" y="172" width="16" height="34" rx="2" {...soft} />
      <rect x="330" y="160" width="12" height="11" rx="1.5" {...soft} />
      <rect x="366" y="160" width="12" height="11" rx="1.5" {...soft} />
    </svg>
  );
}
