import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "@fontsource-variable/public-sans";
import "./globals.css";

import { ServiceWorkerRegister } from "@/components/pwa";
import { DEFAULT_COMPANY_PROFILE } from "@/config/company";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

export const metadata: Metadata = {
  title: {
    default: `${DEFAULT_COMPANY_PROFILE.name} ERP`,
    template: `%s · ${DEFAULT_COMPANY_PROFILE.name} ERP`,
  },
  description: "Distribution, invoicing and accounting for VeeJam Limited.",
  robots: { index: false, follow: false },
  applicationName: "VeeJam ERP",
  appleWebApp: { capable: true, title: "VeeJam ERP", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b6e5b" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1714" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Reading the request makes every page render per request, which the
  // Content-Security-Policy nonce needs (a page built ahead of time has no nonce).
  await headers();
  // The theme chosen on this device, drawn by the server so the page never flashes the wrong colours.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-KE" className="h-full" data-theme={theme === "system" ? undefined : theme}>
      <body className="min-h-full">
        {children}
        <Toaster position="top-right" richColors closeButton theme={theme} />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
