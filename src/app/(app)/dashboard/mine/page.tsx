import { redirect } from "next/navigation";

import { NoAccess } from "@/components/no-access";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";

import { MyDashboard } from "../my-dashboard";

export const metadata = { title: "My sales" };

export default async function MySalesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "dashboard.own")) return <NoAccess what="a sales dashboard" />;
  // Without the business view, /dashboard already is their own dashboard.
  if (!hasPermission(user, "reports.view")) redirect("/dashboard");
  return <MyDashboard user={user} withTabs />;
}
