-- Per-person duties: changes to a user's role defaults made by an owner or admin.

-- CreateTable
CREATE TABLE "user_duty_changes" (
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_duty_changes_pkey" PRIMARY KEY ("user_id","permission")
);

-- AddForeignKey
ALTER TABLE "user_duty_changes" ADD CONSTRAINT "user_duty_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Rules the database enforces ─────────────────────────────────────

-- Permission keys look like "area.action" (the app checks them against its list).
ALTER TABLE "user_duty_changes" ADD CONSTRAINT "user_duty_changes_permission_chk" CHECK (
  "permission" ~ '^[a-z_]+(\.[a-z_]+)+$'
);
-- WhatsApp commands stay with owners: they can never be switched on for anyone else.
ALTER TABLE "user_duty_changes" ADD CONSTRAINT "user_duty_changes_whatsapp_chk" CHECK (
  NOT ("permission" = 'whatsapp.use' AND "granted")
);

-- Supabase's Data API is not used; block it as on all other tables.
ALTER TABLE "user_duty_changes" ENABLE ROW LEVEL SECURITY;
