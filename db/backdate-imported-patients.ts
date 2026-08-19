import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { createClient } from "@libsql/client";

/**
 * Fixes a side effect of the legacy patient import: those rows took the schema
 * default for created_at (= the moment of import), so all 2,097 of them count
 * as "registered today" on the dashboard.
 *
 * The CSV carries no registration date, so their true dates are unknowable —
 * we stamp them with a single explicit "migrated from the old system" date
 * instead, which keeps them out of today's figures.
 *
 *   npx tsx db/backdate-imported-patients.ts --dry
 *   npx tsx db/backdate-imported-patients.ts --date=2026-07-01
 *
 * Only touches rows tagged created_by = 'import:old_patients_data', so
 * genuinely new registrations are never affected.
 */

const TAG = "import:old_patients_data";
const DRY = process.argv.includes("--dry");
const dateArg = process.argv.find((a) => a.startsWith("--date="))?.split("=")[1] ?? "2026-07-01";

async function main() {
  const when = new Date(`${dateArg}T00:00:00`);
  if (Number.isNaN(when.getTime())) throw new Error(`Bad --date: ${dateArg} (use YYYY-MM-DD)`);
  const ts = Math.floor(when.getTime() / 1000);

  const client = createClient({
    url: process.env.DATABASE_URL || "file:local.db",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });

  const n = await client.execute({ sql: "select count(*) as n from patients where created_by = ?", args: [TAG] });
  const todayN = await client.execute(
    "select count(*) as n from patients where created_at >= unixepoch('now','start of day')",
  );
  console.log(`mode: ${DRY ? "DRY-RUN" : "WRITE"}`);
  console.log(`imported patients found: ${n.rows[0].n}`);
  console.log(`patients currently counted as "today": ${todayN.rows[0].n}`);
  console.log(`would stamp created_at/updated_at = ${dateArg} (${ts})`);

  if (DRY) {
    console.log("\nDRY-RUN — re-run without --dry to apply.");
    process.exit(0);
  }

  await client.execute({
    sql: "update patients set created_at = ?, updated_at = ? where created_by = ?",
    args: [ts, ts, TAG],
  });

  const after = await client.execute(
    "select count(*) as n from patients where created_at >= unixepoch('now','start of day')",
  );
  const total = await client.execute("select count(*) as n from patients");
  console.log(`\n✓ Backdated. Patients now counted as "today": ${after.rows[0].n}`);
  console.log(`✓ Total patients still present: ${total.rows[0].n} (nothing deleted)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
