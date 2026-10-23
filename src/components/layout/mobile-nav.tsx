"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { cn } from "@/lib/utils";

/** Stop the page behind the open menu from scrolling (kept outside the component on purpose). */
function lockPageScroll(locked: boolean) {
  document.documentElement.style.overflow = locked ? "hidden" : "";
}

/**
 * Phone menu: a fixed top bar with the menu button on the left, and a panel
 * that slides in over the page (the page stays where it is, dimmed behind).
 * Closes on ✕, a tap outside, Escape / the back gesture's Escape, or choosing
 * a page. While closed, the panel is inert: not focusable, hidden from screen readers.
 */
export function MobileNav({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    lockPageScroll(open);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        openButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      lockPageScroll(false);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    openButton.current?.focus();
  };

  return (
    <div className="contents md:hidden">
      <header className="bg-sidebar text-sidebar-foreground sticky top-0 z-30 flex h-14 items-center gap-3 px-3 shadow-sm">
        <button
          ref={openButton}
          type="button"
          onClick={() => {
            // Show the panel now, then move focus into it in the same step.
            flushSync(() => setOpen(true));
            closeButton.current?.focus();
          }}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="hover:bg-sidebar-accent focus-visible:ring-sidebar-foreground/40 inline-flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2"
        >
          <Menu className="size-5" aria-hidden />
          <span className="sr-only">Open menu</span>
        </button>
        {title}
      </header>

      {/* Dimmed page behind the panel; tapping it closes the menu. */}
      <div
        aria-hidden
        onClick={close}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <div
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!open}
        // Choosing any link closes the menu (the page underneath is replaced by then).
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
        className={cn(
          "bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-50 flex w-[85%] max-w-xs flex-col shadow-2xl",
          "duration-200 ease-out motion-reduce:transition-none",
          // Shown at once when opening (so focus can move in); hidden only after sliding out when closing.
          open
            ? "visible translate-x-0 transition-transform"
            : "invisible -translate-x-full transition-[transform,visibility]",
        )}
      >
        <div className="border-sidebar-border flex h-14 shrink-0 items-center gap-3 border-b px-3">
          <button
            ref={closeButton}
            type="button"
            onClick={close}
            className="hover:bg-sidebar-accent focus-visible:ring-sidebar-foreground/40 inline-flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2"
          >
            <X className="size-5" aria-hidden />
            <span className="sr-only">Close menu</span>
          </button>
          {title}
        </div>
        <div className="grid flex-1 content-start gap-4 overflow-y-auto overscroll-contain px-2 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
