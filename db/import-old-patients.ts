import { config } from "dotenv";
// Load .env.local first (takes precedence, mirrors Next.js), then .env fills gaps.
config({ path: ".env.local" });
config({ path: ".env" });
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import * as schema from "../src/db/schema";
import { formatCode } from "../src/lib/utils";

/**
 * One-off migration: import legacy patient records (registration info only,
 * no test/visit history) from a CSV into the live `patients` table.
 *
 *   npx tsx db/import-old-patients.ts [path-to-csv] [--dry]
 *
 * Idempotent: skips any code already present for the lab, so it is safe to
 * re-run. After inserting, it bumps the `patient` counter so newly registered
 * patients get codes ABOVE every imported code (no future collisions).
 */

const CSV_PATH = process.argv.find((a) => a.endsWith(".csv")) || "old_patients_data.csv";
const DRY = process.argv.includes("--dry");
const BATCH = 400;

/** Minimal RFC-4180-ish CSV parser (handles quotes + embedded commas). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  const s = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n") { record.push(field); rows.push(record); field = ""; record = []; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || record.length) { record.push(field); rows.push(record); }
  const header = rows.shift()!.map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

async function main() {
  const client = createClient({
    url: process.env.DATABASE_URL || "file:local.db",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  const db = drizzle(client, { schema });

  const lab = (await db.select().from(schema.labs).limit(1)).at(0);
  if (!lab) throw new Error("No lab found — seed a lab first.");
  const labId = lab.id;
  const settings = (
    await db.select().from(schema.labSettings).where(eq(schema.labSettings.labId, labId))
  ).at(0);
  const prefix = settings?.patientPrefix || "P";

  const raw = parseCsv(readFileSync(CSV_PATH, "utf8"));
  console.log(`Read ${raw.length} rows from ${CSV_PATH}`);
  console.log(`Lab: ${lab.name} (${labId})  •  prefix: "${prefix}"  •  mode: ${DRY ? "DRY-RUN" : "WRITE"}`);

  // Build normalized records.
  let maxNum = 0;
  const seen = new Set<string>();
  const records = raw.map((r) => {
    const num = parseInt(r.code.replace(/\D/g, ""), 10);
    if (num > maxNum) maxNum = num;
    const code = formatCode(prefix, num);
    const phone = r.phone && r.phone !== "0" ? r.phone : null;
    const genderRaw = r.gender.toLowerCase();
    const gender = (["male", "female", "other"].includes(genderRaw) ? genderRaw : "other") as
      | "male"
      | "female"
      | "other";
    const ageValue = Number.isFinite(parseInt(r.age_value, 10)) ? parseInt(r.age_value, 10) : null;
    return {
      id: randomUUID(),
      labId,
      code,
      fullName: r.full_name,
      gender,
      ageValue,
      ageUnit: "years" as const,
      phone,
      isActive: true,
      createdBy: "import:old_patients_data",
    };
  });

  // Guard against duplicate codes within the CSV itself.
  for (const rec of records) {
    if (seen.has(rec.code)) console.warn(`  ! duplicate code in CSV: ${rec.code}`);
    seen.add(rec.code);
  }

  // Skip codes already present in the DB (idempotency).
  const allCodes = [...seen];
  const existing = new Set<string>();
  for (let i = 0; i < allCodes.length; i += 500) {
    const chunk = allCodes.slice(i, i + 500);
    const found = await db
      .select({ code: schema.patients.code })
      .from(schema.patients)
      .where(and(eq(schema.patients.labId, labId), inArray(schema.patients.code, chunk)));
    found.forEach((f) => existing.add(f.code));
  }

  const toInsert = records.filter((r) => !existing.has(r.code));
  console.log(
    `Max old code number: ${maxNum}  •  already in DB: ${existing.size}  •  to insert: ${toInsert.length}`,
  );
  console.log("Sample:", toInsert.slice(0, 3).map((r) => ({ code: r.code, name: r.fullName, phone: r.phone })));

  if (DRY) {
    console.log(`\nDRY-RUN — would insert ${toInsert.length} patients and set patient counter to ${maxNum}.`);
    console.log("Re-run without --dry to apply.");
    process.exit(0);
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    await db.insert(schema.patients).values(batch);
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${toInsert.length}`);
  }

  // Bump the patient counter so new registrations start ABOVE every old code.
  await db
    .insert(schema.counters)
    .values({ labId, entity: "patient", period: "all", value: maxNum })
    .onConflictDoNothing();
  await db
    .update(schema.counters)
    .set({ value: sql`MAX(${schema.counters.value}, ${maxNum})` })
    .where(
      and(
        eq(schema.counters.labId, labId),
        eq(schema.counters.entity, "patient"),
        eq(schema.counters.period, "all"),
      ),
    );
  const ctr = (
    await db
      .select({ value: schema.counters.value })
      .from(schema.counters)
      .where(
        and(
          eq(schema.counters.labId, labId),
          eq(schema.counters.entity, "patient"),
          eq(schema.counters.period, "all"),
        ),
      )
  ).at(0);

  console.log(`\n✓ Inserted ${inserted} patients.`);
  console.log(`✓ Patient counter is now ${ctr?.value} → next new patient will be ${formatCode(prefix, (ctr?.value ?? 0) + 1)}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
