import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "@fontsource-variable/public-sans";
import "./globals.css";

import { DEFAULT_COMPANY_PROFILE } from "@/config/company";

export const metadata: Metadata = {
  title: {
    default: `${DEFAULT_COMPANY_PROFILE.name} ERP`,
    template: `%s · ${DEFAULT_COMPANY_PROFILE.name} ERP`,
  },
  description: "Distribution, invoicing and accounting for VeeJam Limited.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Reading the request makes every page render per request, which the
  // Content-Security-Policy nonce needs (a page built ahead of time has no nonce).
  await headers();
  return (
    <html lang="en-KE" className="h-full">
      <body className="min-h-full">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
