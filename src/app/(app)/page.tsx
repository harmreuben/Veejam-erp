import { redirect } from "next/navigation";

import { homePathFor } from "@/config/modules";
import { requireUser } from "@/server/auth/session";

/** "/" sends each person to their own starting page (the dashboard, if they may see it). */
export default async function Home() {
  const user = await requireUser();
  redirect(homePathFor(user.role, user.permissions));
}
