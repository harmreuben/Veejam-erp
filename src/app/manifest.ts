import type { MetadataRoute } from "next";

import { DEFAULT_COMPANY_PROFILE } from "@/config/company";

/**
 * Web app manifest: lets staff install the ERP on a phone or PC so it opens
 * from its own icon in its own window. Served at /manifest.webmanifest
 * (public, because browsers fetch it without the session cookie).
 */
const shortcutIcon = { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" };

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${DEFAULT_COMPANY_PROFILE.name} ERP`,
    short_name: "VeeJam ERP",
    description: "Invoicing, stock, payments and accounts for VeeJam Limited.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#f5f7fa",
    theme_color: "#142b4a",
    lang: "en-KE",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press (Android) or right-click (Windows) the app icon for these.
    shortcuts: [
      { name: "New invoice", url: "/invoices/new", icons: [shortcutIcon] },
      { name: "Record payment", url: "/payments/new", icons: [shortcutIcon] },
      {
        name: "Record a stock purchase",
        short_name: "Stock purchase",
        url: "/stock-purchases/new",
        icons: [shortcutIcon],
      },
      { name: "Dashboard", url: "/dashboard", icons: [shortcutIcon] },
    ],
    // Shown in the install window on Android and desktop. The sign-in page only:
    // no business figures in pictures that anyone installing can see.
    screenshots: [
      {
        src: "/screenshots/wide.png",
        sizes: "1280x800",
        type: "image/png",
        form_factor: "wide",
        label: "VeeJam ERP sign-in on a computer",
      },
      {
        src: "/screenshots/narrow.png",
        sizes: "390x844",
        type: "image/png",
        form_factor: "narrow",
        label: "VeeJam ERP sign-in on a phone",
      },
    ],
    prefer_related_applications: false,
    // Clicking the icon again brings the open VeeJam window forward instead of opening a second one.
    ...({ launch_handler: { client_mode: ["focus-existing", "auto"] } } as object),
  };
}
