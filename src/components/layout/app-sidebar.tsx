import Link from "next/link";
import {
  Boxes,
  ChartColumn,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import { signOut } from "@/app/(auth)/login/actions";
import { Logo } from "@/components/brand/logo";
import { InstallAppButton } from "@/components/pwa";
import { ThemeToggle } from "@/components/theme-toggle";
import { canSeeModule, ERP_MODULES, type ErpModule, type SectionIcon } from "@/config/modules";
import { ROLE_LABELS, type Permission } from "@/server/auth/permissions";
import type { AppUser } from "@/server/auth/resolve";
import type { ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";

const ICONS: Record<SectionIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  products: Package,
  inventory: Boxes,
  customers: Users,
  suppliers: Truck,
  sales: ShoppingCart,
  invoices: FileText,
  payments: HandCoins,
  expenses: Receipt,
  funds: Landmark,
  reports: ChartColumn,
  whatsapp: MessageSquare,
  settings: Settings,
};

function ModuleItem({ module, permissions }: { module: ErpModule; permissions: readonly Permission[] }) {
  const Icon = ICONS[module.icon];
  if (module.href) {
    if (!canSeeModule(module, permissions)) return null;
    return (
      <NavLink href={module.href} match={module.paths}>
        <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
        {module.name}
      </NavLink>
    );
  }
  return (
    <span
      aria-disabled="true"
      title="Being built next"
      className="text-sidebar-muted flex cursor-default items-center gap-2 rounded-md px-3 py-1.5 text-sm"
    >
      <Icon className="size-4 shrink-0 opacity-60" aria-hidden />
      <span className="flex-1">{module.name}</span>
      <span className="text-[10px] tracking-wide uppercase">Soon</span>
    </span>
  );
}

function ModuleNav({ permissions, className }: { permissions: readonly Permission[]; className?: string }) {
  return (
    <nav aria-label="Modules" className={cn("grid content-start gap-0.5", className)}>
      {ERP_MODULES.map((m) => (
        <ModuleItem key={m.slug} module={m} permissions={permissions} />
      ))}
    </nav>
  );
}

function Wordmark({ companyName }: { companyName: string }) {
  // The logo keeps its own green tile on the navy menu.
  return <Logo name={companyName} tile="brand" className="min-w-0" />;
}

/** The wordmark as a link home (desktop; on phones the wordmark opens the menu). */
function HomeLink({ companyName }: { companyName: string }) {
  return (
    <Link href="/" className="block rounded-md">
      <Wordmark companyName={companyName} />
    </Link>
  );
}

function UserCard({ user, theme }: { user: AppUser; theme: ThemeChoice }) {
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
      <ThemeToggle initial={theme} className="border-sidebar-border text-sidebar-muted mt-1" />
    </div>
  );
}

export function AppSidebar({
  companyName,
  user,
  permissions,
  theme,
}: {
  companyName: string;
  user: AppUser;
  permissions: readonly Permission[];
  theme: ThemeChoice;
}) {
  return (
    <>
      {/* Desktop */}
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-dvh w-[17rem] shrink-0 flex-col gap-6 overflow-y-auto border-r px-3 py-5 md:flex">
        <div className="px-3">
          <HomeLink companyName={companyName} />
        </div>
        <ModuleNav permissions={permissions} className="flex-1 content-start" />
        <UserCard user={user} theme={theme} />
      </aside>

      {/* Phone: a fixed top bar, and a menu that slides in over the page. */}
      <MobileNav title={<Wordmark companyName={companyName} />}>
        <ModuleNav permissions={permissions} />
        <UserCard user={user} theme={theme} />
      </MobileNav>
    </>
  );
}
