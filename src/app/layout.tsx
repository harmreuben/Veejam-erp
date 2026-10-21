import type { Metadata } from "next";
import "@fontsource-variable/public-sans";
import "./globals.css";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { DEFAULT_COMPANY_PROFILE } from "@/config/company";

export const metadata: Metadata = {
  title: {
    default: `${DEFAULT_COMPANY_PROFILE.name} ERP`,
    template: `%s · ${DEFAULT_COMPANY_PROFILE.name} ERP`,
  },
  description: "Distribution, invoicing and accounting for VeeJam Limited.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-KE" className="h-full">
      <body className="flex min-h-full flex-col md:flex-row">
        <AppSidebar companyName={DEFAULT_COMPANY_PROFILE.name} />
        <main className="min-w-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
