"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { THEME_COOKIE, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Switch the page's colours now and remember the choice on this device for a year. */
function applyTheme(value: ThemeChoice) {
  const root = document.documentElement;
  if (value === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", value);
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax${secure}`;
}

/**
 * Light / Dark / System. Applied at once on this page and remembered on this
 * device in a cookie, so the next page is drawn in the right theme straight away.
 */
export function ThemeToggle({ initial, className }: { initial: ThemeChoice; className?: string }) {
  const [theme, setTheme] = useState<ThemeChoice>(initial);

  const choose = (value: ThemeChoice) => {
    setTheme(value);
    applyTheme(value);
  };

  return (
    <div role="group" aria-label="Colour theme" className={cn("flex rounded-md border p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => choose(value)}
          title={value === "system" ? "Follow this device's setting" : `${label} theme`}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
            theme === value
              ? "bg-sidebar-accent text-sidebar-foreground font-medium"
              : "hover:text-sidebar-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
