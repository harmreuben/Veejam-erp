"use client";

import { Loader2, Send } from "lucide-react";
import { useRef } from "react";

import { useActionForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { simulateAction } from "./actions";

const QUICK = ["HELP", "SALES TODAY", "PAYMENTS TODAY", "LOW STOCK", "OWED"];

export function SimulatorForm() {
  const { state, formAction, pending, errors } = useActionForm(simulateAction);
  const input = useRef<HTMLInputElement>(null);
  const message = state.ok
    ? null
    : (state.fieldErrors?.form?.join(" ") ??
      errors("text")?.join(" ") ??
      errors("from")?.join(" ") ??
      state.message);

  return (
    <form
      action={(fd) => {
        formAction(fd);
        if (input.current) input.current.value = "";
      }}
      className="grid gap-3 border-t p-3"
    >
      <div className="flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <Button key={q} type="submit" name="quick" value={q} variant="outline" size="sm" disabled={pending}>
            {q}
          </Button>
        ))}
      </div>
      <div className="flex gap-2">
        <label htmlFor="sim-text" className="sr-only">
          Message
        </label>
        <Input
          ref={input}
          id="sim-text"
          name="text"
          placeholder="Type a command, e.g. STOCK Big G"
          autoComplete="off"
          maxLength={1000}
          className="flex-1"
        />
        <Button type="submit" disabled={pending} aria-label="Send">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          Send
        </Button>
      </div>
      <details className="text-muted-foreground text-sm">
        <summary className="cursor-pointer">Send as another number (to see what strangers get)</summary>
        <div className="mt-2 grid max-w-xs gap-1">
          <label htmlFor="sim-from">From number</label>
          <Input id="sim-from" name="from" inputMode="tel" placeholder="254799999999" />
        </div>
      </details>
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
