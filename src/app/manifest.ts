import type { MetadataRoute } from "next";

import { DEFAULT_COMPANY_PROFILE } from "@/config/company";

/**
 * Web app manifest: lets staff install the ERP on a phone or PC so it opens
 * from its own icon in its own window. Served at /manifest.webmanifest
 * (public, because browsers fetch it without the session cookie).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${DEFAULT_COMPANY_PROFILE.name} ERP`,
    short_name: "VeeJam ERP",
    description: "Invoicing, stock, payments and accounts for VeeJam Limited.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f7f6",
    theme_color: "#0b6e5b",
    lang: "en-KE",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New invoice", url: "/invoices/new" },
      { name: "Record payment", url: "/payments/new" },
      { name: "Dashboard", url: "/dashboard" },
    ],
  };
}
