import Link from "next/link";
import { LayoutGrid, Menu } from "lucide-react";

import { ERP_MODULES, MODULE_GROUPS, type ErpModule } from "@/config/modules";
import { cn } from "@/lib/utils";

function ModuleLink({ module }: { module: ErpModule }) {
  if (module.href) {
    return (
      <Link
        href={module.href}
        className="hover:bg-sidebar-accent flex items-center justify-between rounded-md px-3 py-1.5 text-sm"
      >
        {module.name}
      </Link>
    );
  }
  return (
    <span
      aria-disabled="true"
      title={`Built in phase ${module.phase}`}
      className="text-sidebar-muted flex cursor-default items-center justify-between rounded-md px-3 py-1.5 text-sm"
    >
      {module.name}
      <span className="text-xs">Phase {module.phase}</span>
    </span>
  );
}

function ModuleNav({ className }: { className?: string }) {
  return (
    <nav aria-label="Modules" className={cn("grid gap-5", className)}>
      <Link
        href="/"
        aria-current="page"
        className="bg-sidebar-accent flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium"
      >
        <LayoutGrid className="size-4" aria-hidden />
        Setup status
      </Link>
      {MODULE_GROUPS.map((group) => (
        <div key={group} className="grid gap-0.5">
          <h3 className="text-sidebar-muted px-3 pb-1 text-xs font-semibold">{group}</h3>
          {ERP_MODULES.filter((m) => m.group === group).map((m) => (
            <ModuleLink key={m.slug} module={m} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function Wordmark({ companyName }: { companyName: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-lg font-bold tracking-tight">{companyName}</span>
      <span className="text-sidebar-muted text-xs">ERP</span>
    </div>
  );
}

export function AppSidebar({ companyName }: { companyName: string }) {
  return (
    <>
      {/* Desktop */}
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r px-3 py-5 md:flex">
        <div className="px-3">
          <Wordmark companyName={companyName} />
        </div>
        <ModuleNav />
      </aside>

      {/* Mobile: collapsible menu, works without JavaScript */}
      <details className="bg-sidebar text-sidebar-foreground group md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
          <Wordmark companyName={companyName} />
          <Menu className="size-5" aria-label="Open menu" />
        </summary>
        <ModuleNav className="px-2 pb-4" />
      </details>
    </>
  );
}
