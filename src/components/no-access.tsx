import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="mx-auto grid max-w-lg justify-items-start gap-3 px-4 py-16 md:px-10">
      <ShieldAlert className="text-warning size-8" aria-hidden />
      <h1 className="text-xl font-semibold">You don&apos;t have access to {what}</h1>
      <p className="text-muted-foreground text-sm">
        Your role doesn&apos;t include this area. If you need it for your work, ask the owner to change your
        role.
      </p>
      <Link href="/" className="text-primary text-sm underline-offset-4 hover:underline">
        Back to the start page
      </Link>
    </div>
  );
}
