"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

import { useActionForm, type FormAction } from "@/components/forms";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { deliveryAction, documentAction } from "./actions";

type Hidden = Record<string, string | number>;

function HiddenFields({ values }: { values: Hidden }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

/** One click, no questions: e.g. "Mark sent". */
export function ActionButton({
  label,
  hidden,
  variant = "outline",
  delivery = false,
  action,
}: {
  label: string;
  hidden: Hidden;
  variant?: "default" | "outline" | "ghost";
  delivery?: boolean;
  action?: FormAction;
}) {
  const { submit, pending, state } = useActionForm(action ?? (delivery ? deliveryAction : documentAction));
  return (
    <form onSubmit={submit} className="contents">
      <HiddenFields values={hidden} />
      <Button type="submit" variant={variant} disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {label}
      </Button>
      {!state.ok && state.message && (
        <span className="sr-only" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}

/**
 * A button that asks first, optionally collecting a reason or other text.
 * The dialog stays open on errors and shows the server's message.
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  hidden,
  fields = [],
  destructive = false,
  variant = "outline",
  delivery = false,
  action,
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  hidden: Hidden;
  fields?: {
    name: string;
    label: string;
    required?: boolean;
    placeholder?: string;
    /** A tick box instead of a text box; `checked` is its starting state. */
    checkbox?: boolean;
    checked?: boolean;
  }[];
  destructive?: boolean;
  variant?: "default" | "outline" | "ghost";
  delivery?: boolean;
  action?: FormAction;
}) {
  const { submit, pending, state, errors } = useActionForm(
    action ?? (delivery ? deliveryAction : documentAction),
  );
  // Open since this time; a successful submission after it closes the dialog.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const succeeded = state.ok && !!state.at && openedAt !== null && state.at >= openedAt;
  const open = openedAt !== null && !succeeded;
  const message = !state.ok ? state.message : null;
  return (
    <AlertDialog open={open} onOpenChange={(o) => setOpenedAt(o ? Date.now() : null)}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          className={destructive && variant === "ghost" ? "text-destructive" : undefined}
        >
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <HiddenFields values={hidden} />
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2 text-sm">{description}</div>
          </AlertDialogDescription>
          {fields.map((f) =>
            f.checkbox ? (
              <label key={f.name} className="flex items-start gap-2 text-sm">
                <input type="hidden" name={f.name} value="false" />
                <input
                  type="checkbox"
                  name={f.name}
                  value="true"
                  defaultChecked={f.checked}
                  className="accent-primary mt-0.5 size-4"
                />
                {f.label}
              </label>
            ) : (
              <div key={f.name} className="grid gap-1.5">
                <Label htmlFor={`dlg-${f.name}`}>{f.label}</Label>
                <Textarea
                  id={`dlg-${f.name}`}
                  name={f.name}
                  rows={2}
                  required={f.required}
                  placeholder={f.placeholder}
                  aria-invalid={errors(f.name) ? true : undefined}
                />
                {errors(f.name) && <p className="text-destructive text-xs">{errors(f.name)!.join(" ")}</p>}
              </div>
            ),
          )}
          {message && (
            <p role="alert" className="text-destructive text-sm">
              {message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Back</AlertDialogCancel>
            <Button
              type="submit"
              disabled={pending}
              className={destructive ? "bg-destructive hover:bg-destructive/90 text-white" : undefined}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Creates a share link and shows it once, with a copy button. */
export function ShareLinkButton({ documentId }: { documentId: string }) {
  const { submit, pending, state } = useActionForm(documentAction);
  const [copied, setCopied] = useState(false);
  const url = state.ok && state.data?.token ? `${window.location.origin}/d/${state.data.token}` : null;
  return (
    <div className="grid gap-2">
      <form onSubmit={submit}>
        <HiddenFields values={{ id: documentId, intent: "share" }} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Create share link
        </Button>
      </form>
      {url && (
        <div className="bg-muted grid gap-1 rounded-md p-3 text-sm">
          <p className="font-medium">
            Send this link to the customer. It is shown only once and works for 30 days.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs" data-testid="share-url">
              {url}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard?.writeText(url).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
