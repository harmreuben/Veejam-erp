"use client";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

import { cancelImportAction, commitImportAction, uploadImportAction } from "./actions";

export function UploadForm({ kinds }: { kinds: { value: string; label: string }[] }) {
  const { state, submit, pending, errors } = useActionForm(uploadImportAction);
  return (
    <form onSubmit={submit} className="bg-card grid gap-4 rounded-lg border p-5" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="kind" label="What are you importing?" errors={errors("kind")}>
          <select name="kind" className={selectClass}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="file"
          label="CSV file"
          hint="Up to 2 MB / 5,000 rows. In Excel: Save As → CSV UTF-8."
          errors={errors("file")}
        >
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="file:bg-secondary file:text-secondary-foreground text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5"
          />
        </Field>
      </div>
      <SubmitBar pending={pending} state={state} label="Check file" pendingLabel="Checking…">
        <span className="text-muted-foreground text-sm">
          Nothing is saved until you review the rows and confirm.
        </span>
      </SubmitBar>
    </form>
  );
}

export function ReviewButtons({ id, canCommit }: { id: string; canCommit: boolean }) {
  const commit = useActionForm(commitImportAction);
  const cancel = useActionForm(cancelImportAction);
  const message = !commit.state.ok ? commit.state.message : !cancel.state.ok ? cancel.state.message : null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {canCommit && (
          <form onSubmit={commit.submit}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" disabled={commit.pending || cancel.pending}>
              {commit.pending ? "Importing…" : "Import these rows"}
            </Button>
          </form>
        )}
        <form onSubmit={cancel.submit}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="outline" disabled={commit.pending || cancel.pending}>
            Cancel import
          </Button>
        </form>
      </div>
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
