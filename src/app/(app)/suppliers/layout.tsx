import type { ReactNode } from "react";

import { SuppliersSection } from "../_purchasing/suppliers-layout";

export default function Layout({ children }: { children: ReactNode }) {
  return <SuppliersSection>{children}</SuppliersSection>;
}
