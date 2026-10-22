/**
 * Take an encrypted backup of the whole database.
 *
 *   npm run backup                      → backups\veejam-backup-<date>-<time>.vjb
 *   npm run backup -- --out D:\Backups  → somewhere else (a USB drive, a synced folder)
 *
 * Needs BACKUP_PASSPHRASE in .env.local. Reads DIRECT_URL (or DATABASE_URL).
 * Copy the file somewhere other than this computer; keep the passphrase
 * separately (a password manager). Restore with `npm run backup:restore`.
 */
import "./load-env.mjs";

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkPassphrase, createBackup, fileSha256, recordBackupRun } from "@/server/backup/backup";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL / DATABASE_URL is not set in .env.local.");
  process.exit(1);
}

try {
  const passphrase = checkPassphrase(process.env.BACKUP_PASSPHRASE);
  const outDir = path.resolve(arg("out") ?? "backups");
  mkdirSync(outDir, { recursive: true });
  // Nairobi time in the name, e.g. veejam-backup-20261021-203800.vjb
  const stamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Africa/Nairobi" })
    .replace(/[-:]/g, "")
    .replace(" ", "-");
  const fileName = `veejam-backup-${stamp}.vjb`;
  const takenBy = `backup:${os.userInfo().username}@${os.hostname()}`;

  console.log("Taking a consistent snapshot of every table…");
  const { file, bundle, totalRows } = await createBackup(url, passphrase, takenBy);
  const target = path.join(outDir, fileName);
  writeFileSync(target, file);

  for (const t of bundle.tables) console.log(`  ${t.name.padEnd(28)} ${String(t.rows).padStart(7)} rows`);
  console.log(`\nSaved ${target}`);
  console.log(
    `  ${bundle.tables.length} tables, ${totalRows} rows, ${(file.length / 1024).toFixed(0)} KB, encrypted (AES-256-GCM).`,
  );
  console.log(`  SHA-256 ${fileSha256(file)}`);

  if (!process.argv.includes("--no-record")) {
    await recordBackupRun(url, {
      kind: "backup",
      takenBy,
      fileName,
      tables: bundle.tables.length,
      rows: totalRows,
      bytes: file.length,
      sha256: fileSha256(file),
    });
    console.log("  Recorded in the app (Backup & recovery page).");
  }
  console.log(
    "\nNow copy the file off this computer. Test it now and then with: npm run backup:restore -- --file <file> --to <empty database URL> --migrate",
  );
} catch (error) {
  console.error(`\nBackup failed: ${(error as Error).message}`);
  process.exit(1);
}
