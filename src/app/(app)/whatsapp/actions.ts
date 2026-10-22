"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getServerEnv } from "@/config/env";
import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { authorize } from "@/server/auth/permissions";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ConflictError, ValidationError } from "@/server/errors";
import { handleInbound } from "@/server/whatsapp/inbound";
import { mockProvider } from "@/server/whatsapp/provider";
import { linkWhatsAppNumber, normaliseWhatsAppNumber } from "@/server/whatsapp/service";

/** The simulator: a signed-in owner types a message as if from their phone. Mock provider only. */
export async function simulateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    authorize(toActor(user), "whatsapp.use");
    const env = getServerEnv();
    if (env.WHATSAPP_PROVIDER !== "mock") {
      throw new ConflictError("The simulator only works with WHATSAPP_PROVIDER=mock.");
    }
    const text = String(formData.get("quick") || formData.get("text") || "").trim();
    if (!text) throw new ValidationError({ text: ["Type a message"] });
    if (text.length > 1000) throw new ValidationError({ text: ["At most 1,000 characters"] });

    const db = getDb();
    const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { whatsappNumber: true } });
    const rawFrom = String(formData.get("from") ?? "").trim();
    const from = rawFrom ? normaliseWhatsAppNumber(rawFrom) : me.whatsappNumber;
    if (!from) {
      throw new ValidationError(
        rawFrom
          ? { from: ["Enter a number like 254712345678"] }
          : { form: ["Link your WhatsApp number first"] },
      );
    }
    await handleInbound(
      db,
      { id: `sim.${randomUUID()}`, from, text, type: "text", timestamp: Math.floor(Date.now() / 1000) },
      { provider: mockProvider, ownerNumber: env.VEEJAM_OWNER_WHATSAPP_NUMBER, simulated: true },
    );
    revalidatePath("/whatsapp", "layout");
    for (const p of ["/payments", "/invoices", "/customers", "/accounting", "/inventory"])
      revalidatePath(p, "layout");
    return ""; // the reply appears in the conversation; no toast needed
  });
}

export async function linkNumberAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const n = await linkWhatsAppNumber(
      getDb(),
      toActor(user),
      formToObject(formData),
      getServerEnv().VEEJAM_OWNER_WHATSAPP_NUMBER,
      await requestContext(),
    );
    revalidatePath("/whatsapp", "layout");
    return n ? `WhatsApp number ${n} linked` : "WhatsApp number removed";
  });
}
