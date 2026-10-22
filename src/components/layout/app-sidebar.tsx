import Link from "next/link";
import { LogOut, Menu, UserRound } from "lucide-react";

import { signOut } from "@/app/(auth)/login/actions";
import { InstallAppButton } from "@/components/pwa";
import { ERP_MODULES, MODULE_GROUPS, type ErpModule } from "@/config/modules";
import { ROLE_LABELS, type Permission } from "@/server/auth/permissions";
import type { AppUser } from "@/server/auth/resolve";
import { cn } from "@/lib/utils";

import { NavLink } from "./nav-link";

function ModuleItem({ module, permissions }: { module: ErpModule; permissions: readonly Permission[] }) {
  if (module.href) {
    if (module.permission && !permissions.includes(module.permission)) return null;
    return <NavLink href={module.href}>{module.name}</NavLink>;
  }
  return (
    <span
      aria-disabled="true"
      title={`Built in phase ${module.phaseLabel ?? module.phase}`}
      className="text-sidebar-muted flex cursor-default items-center justify-between rounded-md px-3 py-1.5 text-sm"
    >
      {module.name}
      <span className="text-xs">Phase {module.phaseLabel ?? module.phase}</span>
    </span>
  );
}

function ModuleNav({ permissions, className }: { permissions: readonly Permission[]; className?: string }) {
  return (
    <nav aria-label="Modules" className={cn("grid gap-5", className)}>
      {MODULE_GROUPS.map((group) => (
        <div key={group} className="grid gap-0.5">
          <h3 className="text-sidebar-muted px-3 pb-1 text-xs font-semibold">{group}</h3>
          {ERP_MODULES.filter((m) => m.group === group).map((m) => (
            <ModuleItem key={m.slug} module={m} permissions={permissions} />
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

/** The wordmark as a link home (desktop; on phones the wordmark opens the menu). */
function HomeLink({ companyName }: { companyName: string }) {
  return (
    <Link href="/" className="block rounded-md">
      <Wordmark companyName={companyName} />
    </Link>
  );
}

function UserCard({ user }: { user: AppUser }) {
  return (
    <div className="border-sidebar-border grid gap-2 border-t px-3 pt-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{user.fullName}</p>
        <p className="text-sidebar-muted truncate text-xs">
          {ROLE_LABELS[user.role]} · {user.email}
        </p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href="/account"
          className="text-sidebar-muted hover:text-sidebar-foreground flex items-center gap-2 text-sm"
        >
          <UserRound className="size-4" aria-hidden />
          Your account
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sidebar-muted hover:text-sidebar-foreground flex items-center gap-2 text-sm"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </form>
        <InstallAppButton className="text-sidebar-muted hover:text-sidebar-foreground flex items-center gap-2 text-sm" />
      </div>
    </div>
  );
}

export function AppSidebar({
  companyName,
  user,
  permissions,
}: {
  companyName: string;
  user: AppUser;
  permissions: readonly Permission[];
}) {
  return (
    <>
      {/* Desktop */}
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r px-3 py-5 md:flex">
        <div className="px-3">
          <HomeLink companyName={companyName} />
        </div>
        <ModuleNav permissions={permissions} className="flex-1 content-start" />
        <UserCard user={user} />
      </aside>

      {/* Mobile: collapsible menu, works without JavaScript */}
      <details className="bg-sidebar text-sidebar-foreground md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
          <Wordmark companyName={companyName} />
          <Menu className="size-5" aria-label="Open menu" />
        </summary>
        <div className="grid gap-4 px-2 pb-4">
          <ModuleNav permissions={permissions} />
          <UserCard user={user} />
        </div>
      </details>
    </>
  );
}
