/** A short notice above a page's content (role="status": read out when it appears). */
export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "success";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warning"
      ? "border-warning/40 bg-warning-soft"
      : tone === "success"
        ? "border-success/40 bg-success-soft"
        : "bg-muted";
  return (
    <div role="status" className={`rounded-md border p-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}
