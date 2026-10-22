import { Fragment } from "react";

/** WhatsApp-style text: *bold* becomes bold; line breaks are kept. Everything else is plain text. */
export function MessageText({ body }: { body: string }) {
  const parts = body.split(/(\*[^*\n]+\*)/g);
  return (
    <span className="break-words whitespace-pre-wrap">
      {parts.map((p, i) =>
        /^\*[^*\n]+\*$/.test(p) ? (
          <strong key={i}>{p.slice(1, -1)}</strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}
