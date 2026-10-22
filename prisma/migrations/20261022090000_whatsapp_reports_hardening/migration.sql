-- Phases 6 and 8: WhatsApp messages and confirmations, rate limits, backup log.

-- CreateEnum
CREATE TYPE "WhatsAppDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REFUSED', 'FAILED', 'SENT', 'SIMULATED');

-- CreateEnum
CREATE TYPE "WhatsAppConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "whatsapp_number" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "direction" "WhatsAppDirection" NOT NULL,
    "wa_number" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "status" "WhatsAppMessageStatus" NOT NULL,
    "command" TEXT,
    "user_id" UUID,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "wa_number" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" "WhatsAppConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "result_ref" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taken_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taken_by" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "tables" INTEGER NOT NULL,
    "rows" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'backup',

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_whatsapp_number_key" ON "users"("whatsapp_number");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_provider_message_id_key" ON "whatsapp_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_wa_number_created_at_idx" ON "whatsapp_messages"("wa_number", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_created_at_idx" ON "whatsapp_messages"("created_at");

-- CreateIndex
CREATE INDEX "whatsapp_confirmations_user_id_status_idx" ON "whatsapp_confirmations"("user_id", "status");

-- CreateIndex
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits"("window_start");

-- CreateIndex
CREATE INDEX "backup_runs_taken_at_idx" ON "backup_runs"("taken_at");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_confirmations" ADD CONSTRAINT "whatsapp_confirmations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Rules the database enforces ─────────────────────────────────────

ALTER TABLE "users" ADD CONSTRAINT "users_whatsapp_number_chk" CHECK (
  "whatsapp_number" IS NULL OR "whatsapp_number" ~ '^[1-9][0-9]{7,14}$'
);
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_wa_number_chk" CHECK (
  "wa_number" ~ '^[1-9][0-9]{7,14}$'
);
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_body_chk" CHECK (char_length("body") <= 4096);
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_direction_status_chk" CHECK (
  ("direction" = 'IN' AND "status" IN ('RECEIVED', 'PROCESSED', 'REFUSED', 'FAILED'))
  OR ("direction" = 'OUT' AND "status" IN ('SENT', 'SIMULATED', 'FAILED'))
);
ALTER TABLE "whatsapp_confirmations" ADD CONSTRAINT "whatsapp_confirmations_attempts_chk" CHECK (
  "attempts" BETWEEN 0 AND 5
);
ALTER TABLE "whatsapp_confirmations" ADD CONSTRAINT "whatsapp_confirmations_resolved_chk" CHECK (
  ("status" = 'PENDING') = ("resolved_at" IS NULL)
);
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_count_chk" CHECK ("count" >= 0);
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_kind_chk" CHECK ("kind" IN ('backup', 'restore-drill'));

-- Supabase's Data API is not used; block it on the new tables as on all others.
ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_confirmations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backup_runs" ENABLE ROW LEVEL SECURITY;
