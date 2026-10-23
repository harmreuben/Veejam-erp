/**
 * Re-created on every page change (unlike the layout), so each page eases in.
 * The animation itself is CSS (.vj-page in globals.css) and is skipped for
 * reduced motion.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="vj-page">{children}</div>;
}
