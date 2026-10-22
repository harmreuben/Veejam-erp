/**
 * Shown the moment a link is clicked, while the next page is fetched, so the
 * app responds instantly even when the server takes a moment. Next.js also
 * uses it to prefetch pages up to this point when links scroll into view.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:px-10 md:py-10"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      <div className="grid gap-2" aria-hidden>
        <div className="bg-muted h-8 w-56 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-80 max-w-full animate-pulse rounded-md" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card h-24 animate-pulse rounded-lg border" />
        ))}
      </div>
      <div className="bg-card h-64 animate-pulse rounded-lg border" aria-hidden />
    </div>
  );
}
