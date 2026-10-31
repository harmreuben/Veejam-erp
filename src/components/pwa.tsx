"use client";

import { Download } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

/** Registers the service worker (production only) so the app can be installed. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installing is a convenience; the app works the same without it.
    });
  }, []);
  return null;
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Chrome and Edge fire "beforeinstallprompt" once per page load when the app can
 * be installed. Every install button on the page listens for it.
 */
function useInstallPrompt() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    // Keep the event for our own button, but don't call preventDefault(): Chrome
    // still shows its own install banner, and doesn't log "Banner not shown".
    const onPrompt = (e: Event) => setPrompt(e as InstallPromptEvent);
    const onInstalled = () => {
      setPrompt(null);
      setInstalled(true);
    };
    const standalone = window.matchMedia("(display-mode: standalone)");
    const sync = () =>
      setInstalled(standalone.matches || (navigator as { standalone?: boolean }).standalone === true);
    sync();
    standalone.addEventListener("change", sync);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      standalone.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const install = async () => {
    if (!prompt) return;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // Chrome already showed its own prompt for this event; it can't be shown twice.
    }
    setPrompt(null);
  };
  return { canPrompt: !!prompt, installed, install };
}

/**
 * "Install app" in the menu. Where the browser can install directly (Chrome and
 * Edge on Android and Windows) it does so; elsewhere (an iPhone, Firefox) it
 * opens the page with the steps. Hidden inside the installed app itself.
 */
export function InstallAppButton({ className }: { className?: string }) {
  const { canPrompt, installed, install } = useInstallPrompt();
  if (installed) return null;
  if (!canPrompt) {
    return (
      <a href="/settings/install" className={className}>
        <Download className="size-4" aria-hidden />
        Install app
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={install}>
      <Download className="size-4" aria-hidden />
      Install app
    </button>
  );
}

/** The big button on the install page, plus whether this is already the installed app. */
export function InstallNow() {
  const { canPrompt, installed, install } = useInstallPrompt();
  if (installed) {
    return (
      <p role="status" className="bg-success-soft border-success/40 rounded-md border p-3 text-sm">
        <strong>You&apos;re using the installed app.</strong> It opens from its own icon and keeps itself up
        to date: nothing to download again.
      </p>
    );
  }
  if (!canPrompt) return null;
  return (
    <div className="bg-card flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <p className="flex-1 text-sm">This browser can install VeeJam ERP right now.</p>
      <button
        type="button"
        onClick={install}
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center gap-2 rounded-md px-5 text-sm font-medium"
      >
        <Download className="size-4" aria-hidden />
        Install VeeJam ERP
      </button>
    </div>
  );
}

export type Platform = "android" | "iphone" | "windows" | "other";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1))
    return "iphone";
  if (/windows/i.test(ua)) return "windows";
  return "other";
}
const noSubscribe = () => () => {};

/** Which device this is, so the install page shows its steps first ("other" while rendering on the server). */
export function usePlatform(): Platform {
  return useSyncExternalStore(noSubscribe, detectPlatform, () => "other");
}
