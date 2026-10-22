/**
 * Restore an encrypted backup into an EMPTY database and verify every table.
 * Run it regularly into a throwaway database as a restore drill.
 *
 *   npm run backup:restore -- --file backups\veejam-backup-….vjb --to "postgresql://…/veejam_drill" --migrate
 *
 * --to       the database to restore into (or RESTORE_DATABASE_URL in .env.local). Must be empty.
 * --migrate  first create the tables there with `prisma migrate deploy`.
 *
 * Refuses to touch the databases in DATABASE_URL / DIRECT_URL. When the
 * restore checks out, the drill is recorded in the live database so the app
 * can show when the backups were last proven to work.
 */
import "./load-env.mjs";

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkPassphrase,
  fileSha256,
  readBackup,
  recordBackupRun,
  restoreBackup,
} from "@/server/backup/backup";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const sameDb = (a: string | undefined, b: string | undefined) => {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return (
      x.hostname === y.hostname &&
      x.port === y.port &&
      x.pathname === y.pathname &&
      x.username.split(".")[1] === y.username.split(".")[1]
    );
  } catch {
    return a === b;
  }
};

try {
  const file = arg("file");
  const to = arg("to") ?? process.env.RESTORE_DATABASE_URL;
  if (!file || !to) {
    console.error(
      'Usage: npm run backup:restore -- --file <backup.vjb> --to "<empty database URL>" [--migrate]',
    );
    process.exit(1);
  }
  const live = [process.env.DATABASE_URL, process.env.DIRECT_URL];
  if (live.some((u) => sameDb(u, to))) {
    throw new Error(
      "That is the database the app is using. Restore into a new, empty database, check it, then point .env.local at it.",
    );
  }
  const passphrase = checkPassphrase(process.env.BACKUP_PASSPHRASE);
  const bytes = readFileSync(path.resolve(file));
  console.log("Decrypting and checking the backup…");
  const bundle = readBackup(bytes, passphrase);
  console.log(`  Taken ${bundle.createdAt} by ${bundle.takenBy}; ${bundle.tables.length} tables.`);

  if (process.argv.includes("--migrate")) {
    console.log("Creating the tables in the target database (prisma migrate deploy)…");
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, DATABASE_URL: to, DIRECT_URL: to },
    });
  }

  console.log("Restoring…");
  const report = await restoreBackup(to, bundle);
  for (const t of report.tables) {
    console.log(`  ${t.ok ? "✓" : "✗"} ${t.name.padEnd(28)} ${String(t.rows).padStart(7)} rows`);
  }
  if (!report.verified) throw new Error("Some tables don't match the backup after restoring (marked ✗).");
  console.log(`\nRestored and verified: ${report.totalRows} rows match the backup exactly.`);

  const liveUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (liveUrl && !process.argv.includes("--no-record")) {
    await recordBackupRun(liveUrl, {
      kind: "restore-drill",
      takenBy: `restore:${os.userInfo().username}@${os.hostname()}`,
      fileName: path.basename(file),
      tables: bundle.tables.length,
      rows: report.totalRows,
      bytes: bytes.length,
      sha256: fileSha256(bytes),
    });
    console.log("Recorded the successful drill in the app.");
  }
} catch (error) {
  console.error(`\nRestore failed: ${(error as Error).message}`);
  process.exit(1);
}
