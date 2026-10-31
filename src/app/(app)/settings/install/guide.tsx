"use client";

import { InstallNow, usePlatform, type Platform } from "@/components/pwa";

const STEPS: Record<Exclude<Platform, "other">, { title: string; browser: string; steps: string[] }> = {
  android: {
    title: "Android phone or tablet",
    browser: "Chrome",
    steps: [
      "Open veejam.vercel.app in Chrome and sign in.",
      "Tap the ⋮ menu (top right), then “Install app” (or “Add to Home screen”).",
      "Tap Install. VeeJam ERP appears on your home screen and in your apps list.",
      "Long-press the icon for shortcuts: New invoice, Record payment, Stock purchase.",
    ],
  },
  iphone: {
    title: "iPhone or iPad",
    browser: "Safari",
    steps: [
      "Open veejam.vercel.app in Safari (not Chrome) and sign in.",
      "Tap the Share button (the square with an arrow).",
      "Scroll down and tap “Add to Home Screen”, then Add.",
      "Open VeeJam ERP from the new icon: it runs full screen, like an app.",
    ],
  },
  windows: {
    title: "Windows PC",
    browser: "Microsoft Edge or Chrome",
    steps: [
      "Open veejam.vercel.app in Edge or Chrome and sign in.",
      "Click the install icon at the right end of the address bar (a monitor with a down arrow), or ⋯ menu → Apps → “Install VeeJam ERP”.",
      "Click Install. It opens in its own window and is added to the Start menu.",
      "Right-click it in the Start menu or taskbar to pin it. Right-click the taskbar icon for shortcuts.",
    ],
  },
};

/** Install steps for each kind of device, with this device's first. */
export function InstallGuide() {
  const platform = usePlatform();
  const order: Exclude<Platform, "other">[] = ["android", "iphone", "windows"];
  const sorted = platform === "other" ? order : [platform, ...order.filter((p) => p !== platform)];
  return (
    <div className="grid gap-6">
      <InstallNow />
      <div className="grid gap-4 lg:grid-cols-3">
        {sorted.map((p) => {
          const s = STEPS[p];
          const mine = p === platform;
          return (
            <section
              key={p}
              aria-labelledby={`install-${p}`}
              className={`bg-card grid content-start gap-3 rounded-lg border p-4 ${mine ? "ring-ring ring-2" : ""}`}
            >
              <div>
                <h2 id={`install-${p}`} className="font-semibold">
                  {s.title}{" "}
                  {mine && <span className="text-muted-foreground text-xs font-normal">· this device</span>}
                </h2>
                <p className="text-muted-foreground text-xs">Use {s.browser}</p>
              </div>
              <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
