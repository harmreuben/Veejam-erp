/**
 * Encrypted logical backups of the whole ERP database, and verified restores.
 *
 * A backup is every table's rows as JSON produced by Postgres itself (so
 * numbers, dates and money keep their exact text), gzipped and encrypted with
 * AES-256-GCM using a key derived from a passphrase (scrypt). Without the
 * passphrase the file is unreadable; with a wrong one, or if a single byte is
 * changed, decryption fails instead of restoring damaged data.
 *
 * A restore goes into an EMPTY database that already has the same migrations,
 * inside one transaction, then re-exports every table and checks it matches
 * the backup exactly (SHA-256 per table). That check is the restore drill.
 *
 * Used by scripts/backup.mts and scripts/restore.mts; no Next.js imports.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import pg from "pg";

import { planPgConnection } from "@/server/db/connection";

export const BACKUP_FORMAT = "veejam-backup";
const MAGIC = Buffer.from("VJB1");
/** Tables never backed up: Prisma's own bookkeeping and short-lived counters. */
const SKIP = new Set(["_prisma_migrations", "rate_limits"]);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSPHRASE = 12;

export type TableManifest = { name: string; rows: number; sha256: string };

export type BackupBundle = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  takenBy: string;
  source: { host: string; database: string };
  migrations: string[];
  tables: TableManifest[];
  data: Record<string, string>;
};

export type BackupResult = { file: Buffer; bundle: Omit<BackupBundle, "data">; totalRows: number };

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client(planPgConnection(url).config);
  await client.connect();
  // Same text for timestamps whatever the server's or the computer's time zone.
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

/** Public tables in an order where every table comes after the tables it points to. */
export async function tablesInOrder(client: pg.Client): Promise<string[]> {
  const { rows: tables } = await client.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const { rows: deps } = await client.query<{ child: string; parent: string }>(`
    SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'`);
  const unquote = (s: string) => s.replace(/^"|"$/g, "");
  const names = tables.map((t) => t.name).filter((n) => !SKIP.has(n));
  const parents = new Map(names.map((n) => [n, new Set<string>()]));
  for (const d of deps) {
    const child = unquote(d.child);
    const parent = unquote(d.parent);
    if (child !== parent && parents.has(child) && parents.has(parent)) parents.get(child)!.add(parent);
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string, path: Set<string>) => {
    if (seen.has(n)) return;
    if (path.has(n)) throw new Error(`Foreign keys form a loop at ${n}`);
    path.add(n);
    for (const p of parents.get(n) ?? []) visit(p, path);
    path.delete(n);
    seen.add(n);
    ordered.push(n);
  };
  for (const n of names) visit(n, new Set());
  return ordered;
}

async function primaryKey(client: pg.Client, table: string): Promise<string[]> {
  const { rows } = await client.query<{ col: string }>(
    `SELECT a.attname AS col FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [q(table)],
  );
  return rows.map((r) => r.col);
}

/** One table's rows as JSON text, in primary-key order, exactly as Postgres prints them. */
export async function exportTable(client: pg.Client, table: string): Promise<{ text: string; rows: number }> {
  const pk = await primaryKey(client, table);
  const order = pk.length ? `ORDER BY ${pk.map((c) => `t.${q(c)}`).join(", ")}` : "";
  const { rows } = await client.query<{ data: string; n: number }>(
    `SELECT COALESCE(json_agg(t ${order}), '[]'::json)::text AS data, COUNT(*)::int AS n FROM ${q(table)} t`,
  );
  return { text: rows[0]!.data, rows: rows[0]!.n };
}

export async function appliedMigrations(client: pg.Client): Promise<string[] | null> {
  const { rows } = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists",
  );
  if (!rows[0]!.exists) return null;
  const m = await client.query<{ name: string }>(
    `SELECT migration_name AS name FROM _prisma_migrations
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return m.rows.map((r) => r.name);
}

// ─── Encryption ─────────────────────────────────────────────────────

export function checkPassphrase(passphrase: string | undefined): string {
  if (!passphrase || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(
      `Set BACKUP_PASSPHRASE (at least ${MIN_PASSPHRASE} characters) in .env.local. ` +
        "Keep it somewhere safe and separate from the backups: without it they can't be restored.",
    );
  }
  return passphrase;
}

export function encrypt(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decrypt(file: Buffer, passphrase: string): Buffer {
  if (file.length < 48 || !file.subarray(0, 4).equals(MAGIC)) {
    throw new Error("This isn't a VeeJam backup file.");
  }
  const salt = file.subarray(4, 20);
  const iv = file.subarray(20, 32);
  const tag = file.subarray(32, 48);
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(file.subarray(48)), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase, or the backup file is damaged. Nothing was restored.");
  }
}

// ─── Backup ─────────────────────────────────────────────────────────

export async function createBackup(url: string, passphrase: string, takenBy: string): Promise<BackupResult> {
  checkPassphrase(passphrase);
  const client = await connect(url);
  try {
    // One consistent snapshot of every table, even while people are working.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = await tablesInOrder(client);
    const migrations = (await appliedMigrations(client)) ?? [];
    const data: Record<string, string> = {};
    const manifest: TableManifest[] = [];
    for (const name of tables) {
      const { text, rows } = await exportTable(client, name);
      data[name] = text;
      manifest.push({ name, rows, sha256: sha256(text) });
    }
    await client.query("COMMIT");
    const u = new URL(url);
    const bundle: BackupBundle = {
      format: BACKUP_FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      takenBy,
      source: { host: u.hostname, database: u.pathname.replace(/^\//, "") },
      migrations,
      tables: manifest,
      data,
    };
    const file = encrypt(gzipSync(Buffer.from(JSON.stringify(bundle), "utf8")), passphrase);
    const { data: _omit, ...meta } = bundle;
    void _omit;
    return { file, bundle: meta, totalRows: manifest.reduce((s, t) => s + t.rows, 0) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export function readBackup(file: Buffer, passphrase: string): BackupBundle {
  const bundle = JSON.parse(gunzipSync(decrypt(file, passphrase)).toString("utf8")) as BackupBundle;
  if (bundle.format !== BACKUP_FORMAT || bundle.version !== 1) throw new Error("Unsupported backup format.");
  for (const t of bundle.tables) {
    if (sha256(bundle.data[t.name] ?? "") !== t.sha256)
      throw new Error(`Backup data for ${t.name} is damaged.`);
  }
  return bundle;
}

// ─── Restore ────────────────────────────────────────────────────────

export type RestoreReport = {
  tables: (TableManifest & { ok: boolean })[];
  totalRows: number;
  verified: boolean;
};

/**
 * Restore into an empty database with the same migrations applied, then verify.
 * Refuses (changing nothing) if the target has data or different migrations.
 */
export async function restoreBackup(url: string, bundle: BackupBundle): Promise<RestoreReport> {
  const client = await connect(url);
  try {
    const target = await appliedMigrations(client);
    if (bundle.migrations.length && target === null) {
      throw new Error(
        "The target database has no migrations. Run them first (the restore script's --migrate option).",
      );
    }
    if (target !== null && JSON.stringify(target) !== JSON.stringify(bundle.migrations)) {
      const missing = bundle.migrations.filter((m) => !target.includes(m));
      const extra = target.filter((m) => !bundle.migrations.includes(m));
      throw new Error(
        `The target database's migrations don't match the backup.` +
          (missing.length ? ` Missing: ${missing.join(", ")}.` : "") +
          (extra.length ? ` Not in the backup: ${extra.join(", ")}.` : ""),
      );
    }
    const tables = await tablesInOrder(client);
    const unknown = bundle.tables.filter((t) => !tables.includes(t.name)).map((t) => t.name);
    if (unknown.length) throw new Error(`The target has no table(s): ${unknown.join(", ")}.`);
    for (const t of tables) {
      const { rows } = await client.query<{ any: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${q(t)}) AS any`);
      if (rows[0]!.any)
        throw new Error(
          `The target database isn't empty (${t} has rows). Restore only into an empty database.`,
        );
    }

    await client.query("BEGIN");
    // Load rows exactly as they were: triggers (posted-document locks, journal checks)
    // and foreign-key checks are paused for this transaction only.
    await client.query("SET LOCAL session_replication_role = replica");
    const inBackup = new Map(bundle.tables.map((t) => [t.name, t]));
    for (const table of tables) {
      if (!inBackup.has(table)) continue;
      const { rows: cols } = await client.query<{ col: string }>(
        `SELECT column_name AS col FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
         ORDER BY ordinal_position`,
        [table],
      );
      const list = cols.map((c) => q(c.col)).join(", ");
      await client.query(
        `INSERT INTO ${q(table)} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${q(table)}, $1::json)`,
        [bundle.data[table]],
      );
      // Serial columns (e.g. the audit log id) continue after the restored rows.
      const { rows: serials } = await client.query<{ col: string }>(
        `SELECT column_name AS col FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_default LIKE 'nextval(%'`,
        [table],
      );
      for (const s of serials) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE(MAX(${q(s.col)}), 1), MAX(${q(s.col)}) IS NOT NULL) FROM ${q(table)}`,
          [`public.${q(table)}`, s.col],
        );
      }
    }
    await client.query("COMMIT");

    const report: RestoreReport["tables"] = [];
    for (const t of bundle.tables) {
      const { text, rows } = await exportTable(client, t.name);
      report.push({ ...t, ok: rows === t.rows && sha256(text) === t.sha256 });
    }
    return {
      tables: report,
      totalRows: report.reduce((s, t) => s + t.rows, 0),
      verified: report.every((t) => t.ok),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Write the backup's record into the live database so the app can show when the last one was taken. */
export async function recordBackupRun(
  url: string,
  run: {
    kind: "backup" | "restore-drill";
    takenBy: string;
    fileName: string;
    tables: number;
    rows: number;
    bytes: number;
    sha256: string;
  },
): Promise<void> {
  const client = await connect(url);
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO backup_runs (kind, taken_by, file_name, tables, rows, bytes, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [run.kind, run.takenBy, run.fileName, run.tables, run.rows, run.bytes, run.sha256],
    );
    await client.query(
      `INSERT INTO audit_log (actor_label, action, entity_type, summary, metadata)
       VALUES ($1, $2, 'Backup', $3, $4::jsonb)`,
      [
        run.takenBy,
        run.kind === "backup" ? "BACKUP_TAKEN" : "BACKUP_RESTORED",
        run.kind === "backup"
          ? `Backup ${run.fileName}: ${run.tables} tables, ${run.rows} rows`
          : `Restore drill from ${run.fileName} passed: ${run.tables} tables, ${run.rows} rows verified`,
        JSON.stringify({ fileName: run.fileName, sha256: run.sha256, bytes: run.bytes }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export const fileSha256 = (b: Buffer) => sha256(b);
