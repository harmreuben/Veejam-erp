import { cn } from "@/lib/utils";

/*
 * Small drawings for empty screens ("No invoices yet"). Original artwork, drawn
 * with the theme's colours so they follow light and dark mode. Decoration only:
 * the words next to them say everything, so they're hidden from screen readers.
 */

export type ArtName = "documents" | "shop" | "cartons" | "money" | "truck" | "chart" | "search" | "done";

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const shape = { ...line, fill: "var(--card)" } as const;
const PRIMARY = "var(--primary)";
const ACCENT = "#f0b54a";

function Backdrop() {
  return (
    <>
      <circle cx="60" cy="46" r="38" fill="var(--muted)" />
      <ellipse cx="60" cy="86" rx="40" ry="4" fill="currentColor" opacity="0.12" />
    </>
  );
}

const ART: Record<ArtName, React.ReactNode> = {
  documents: (
    <>
      <rect x="42" y="16" width="44" height="58" rx="4" transform="rotate(7 64 45)" {...shape} />
      <rect x="34" y="20" width="44" height="58" rx="4" {...shape} />
      <path d="M42 32h16M42 41h28M42 49h24M42 57h20" {...line} strokeWidth={2} opacity={0.55} />
      <path d="M56 68h14" {...line} stroke={PRIMARY} strokeWidth={3} />
      <circle cx="82" cy="70" r="10" fill={PRIMARY} />
      <path d="M77 70l3.5 3.5 6.5-7" {...line} stroke="var(--primary-foreground)" strokeWidth={2.5} />
    </>
  ),
  shop: (
    <>
      <rect x="30" y="40" width="60" height="40" rx="3" {...shape} />
      <path
        d="M28 28h64v10q-4 6-8 0q-4 6-8 0q-4 6-8 0q-4 6-8 0q-4 6-8 0q-4 6-8 0q-4 6-8 0q-4 6-8 0z"
        fill={PRIMARY}
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <rect x="53" y="56" width="14" height="24" rx="2" {...shape} />
      <rect x="36" y="50" width="12" height="11" rx="1.5" {...shape} />
      <rect x="72" y="50" width="12" height="11" rx="1.5" {...shape} />
      <circle cx="64" cy="69" r="1.5" fill="currentColor" />
    </>
  ),
  cartons: (
    <>
      <rect x="30" y="54" width="28" height="26" rx="2" {...shape} />
      <rect x="62" y="54" width="28" height="26" rx="2" {...shape} />
      <rect x="46" y="26" width="28" height="26" rx="2" {...shape} />
      <path d="M44 54v9M76 54v9" {...line} />
      <path d="M60 26v9" {...line} stroke={PRIMARY} strokeWidth={4} />
      <path d="M34 72h8M66 72h8" {...line} strokeWidth={2} opacity={0.55} />
      <circle cx="84" cy="30" r="6" fill={ACCENT} />
    </>
  ),
  money: (
    <>
      <rect x="22" y="34" width="60" height="34" rx="4" {...shape} />
      <rect x="28" y="40" width="48" height="22" rx="2" {...line} strokeWidth={1.5} opacity={0.4} />
      <circle cx="52" cy="51" r="8" fill={PRIMARY} opacity={0.85} />
      <circle cx="86" cy="64" r="13" fill={ACCENT} stroke="currentColor" strokeWidth={2.5} />
      <circle cx="86" cy="64" r="7.5" {...line} strokeWidth={2} opacity={0.5} />
    </>
  ),
  truck: (
    <>
      <path d="M8 46h10M4 54h12M10 62h8" {...line} opacity={0.5} />
      <rect x="24" y="36" width="48" height="32" rx="3" {...shape} />
      <path
        d="M72 46h13l9 11v11H72z"
        fill={PRIMARY}
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <path
        d="M76 50h7l5 7H76z"
        fill="var(--card)"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="M34 48h18" {...line} stroke={ACCENT} strokeWidth={4} />
      <circle cx="40" cy="70" r="7" {...shape} />
      <circle cx="82" cy="70" r="7" {...shape} />
      <circle cx="40" cy="70" r="2" fill="currentColor" />
      <circle cx="82" cy="70" r="2" fill="currentColor" />
    </>
  ),
  chart: (
    <>
      <path d="M28 18v58h66" {...line} />
      <rect x="36" y="58" width="10" height="18" rx="2" fill={PRIMARY} opacity={0.35} />
      <rect x="52" y="48" width="10" height="28" rx="2" fill={PRIMARY} opacity={0.55} />
      <rect x="68" y="40" width="10" height="36" rx="2" fill={PRIMARY} opacity={0.75} />
      <rect x="84" y="30" width="10" height="46" rx="2" fill={PRIMARY} />
      <path d="M38 48l16-10 16-6 20-14" {...line} stroke={ACCENT} strokeWidth={3} />
      <path d="M82 17l8 1-2 8" {...line} stroke={ACCENT} strokeWidth={3} />
    </>
  ),
  search: (
    <>
      <rect x="30" y="18" width="42" height="56" rx="4" {...shape} />
      <path d="M38 30h18M38 39h26M38 47h22M38 55h14" {...line} strokeWidth={2} opacity={0.55} />
      <circle cx="74" cy="58" r="13" {...shape} />
      <circle cx="74" cy="58" r="7" fill={PRIMARY} opacity={0.2} />
      <path d="M84 68l10 10" {...line} strokeWidth={6} />
    </>
  ),
  done: (
    <>
      <circle cx="60" cy="48" r="24" fill={PRIMARY} />
      <path d="M49 48l7.5 7.5L72 40" {...line} stroke="var(--primary-foreground)" strokeWidth={4.5} />
      <path
        d="M28 22v8M24 26h8M92 28v6M89 31h6M90 68v8M86 72h8"
        {...line}
        stroke={ACCENT}
        strokeWidth={2.5}
      />
    </>
  ),
};

/** One of the empty-screen drawings, 120×96 by default. */
export function Illustration({ name, className }: { name: ArtName; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 96"
      aria-hidden
      className={cn("text-muted-foreground h-24 w-30 shrink-0", className)}
      data-art={name}
    >
      <Backdrop />
      {ART[name]}
    </svg>
  );
}
