export function RangeError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="bg-card grid gap-0.5 rounded-lg border p-4">
      <div className="text-muted-foreground text-sm">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {note && <div className="text-muted-foreground text-xs">{note}</div>}
    </div>
  );
}
