import "server-only";

import { AppError, ValidationError } from "@/server/errors";

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Changes on every submission so the client can show a fresh toast. */
  at?: number;
};

/**
 * Run a server-action body and turn known errors into a form result.
 * Unknown errors are logged on the server and shown as a generic message,
 * so internal details never reach the browser.
 */
export async function toActionResult(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, message, at: Date.now() };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors, at: Date.now() };
    }
    if (error instanceof AppError) {
      return { ok: false, message: error.message, at: Date.now() };
    }
    // redirect() and notFound() work by throwing; let them through.
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error(error);
    return {
      ok: false,
      message: "Something went wrong. Try again, and tell the owner if it keeps happening.",
      at: Date.now(),
    };
  }
}
