import { config } from "dotenv";
// Load .env.local first (takes precedence, mirrors Next.js), then .env fills gaps.
config({ path: ".env.local" });
config({ path: ".env" });
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";
import * as schema from "../src/db/schema";
import { formatCode } from "../src/lib/utils";

/**
 * Repairs a visit that was registered while one of its tests sat in a
 * BILLING-ONLY department.
 *
 *   npx tsx db/repair-missing-samples.ts V-000009 --dry
 *   npx tsx db/repair-missing-samples.ts V-000009
 *
 * Registration decides once, at the moment the visit is created, whether each
 * test is reportable (`isReportable` in billing-actions.ts — true when the
 * test's department is not billing-only). Reportable tests open a sample, get a
 * result-entry stub and push the visit to `sample_pending`. A test filed under a
 * billing-only department gets none of that, and re-filing the test afterwards
 * does NOT go back and fix visits already registered — so the visit is stranded
 * at `registered` with no sample and never reaches the collection queue.
 *
 * This backfills exactly what registration would have created, and nothing else:
 *
 *   • one sample per distinct sample type (status `waiting`)
 *   • one `pending` result entry per reportable test, linked to that sample
 *   • the visit status moved to `sample_pending`
 *   • a report link, if the visit has none
 *   • refreshes the stale `visit_tests.department_id` snapshot
 *
 * It deliberately does NOT touch the bill, bill items, payments, prices, the
 * patient, or any other visit. Money is never re-computed.
 *
 * Safe to re-run: it refuses a visit that already has samples or result entries.
 */

const VISIT_CODE = process.argv.find((a) => /^[A-Z]+-\d+$/.test(a));
const DRY = process.argv.includes("--dry");
const id = () => randomUUID();

/** Mirrors `publicToken()` in src/lib/crypto.ts (server-only, cannot import). */
function publicToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64").replace(/[+/=]/g, "").slice(0, 32);
}

async function main() {
  if (!VISIT_CODE) throw new Error("Pass a visit code, e.g. V-000009");

  const client = createClient({
    url: process.env.DATABASE_URL || "file:local.db",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  const db = drizzle(client, { schema });

  const visit = (await db.select().from(schema.visits).where(eq(schema.visits.code, VISIT_CODE))).at(0);
  if (!visit) throw new Error(`No visit ${VISIT_CODE}`);
  const labId = visit.labId;

  console.log(`Repairing ${VISIT_CODE}${DRY ? "  (dry run — nothing will be written)" : ""}`);
  console.log(`  status now : ${visit.status}`);

  // ── Guards ───────────────────────────────────────────────────────────────
  if (visit.status === "cancelled") throw new Error("Visit is cancelled — nothing to repair.");
  const existingSamples = await db.select().from(schema.samples).where(eq(schema.samples.visitId, visit.id));
  const existingEntries = await db.select().from(schema.resultEntries).where(eq(schema.resultEntries.visitId, visit.id));
  if (existingSamples.length || existingEntries.length) {
    throw new Error(
      `Visit already has ${existingSamples.length} sample(s) and ${existingEntries.length} result entr(ies) — ` +
        `it is not in the stranded state this repair is for. Aborting.`,
    );
  }

  // ── Resolve which of the visit's tests are reportable TODAY ──────────────
  const vts = await db.select().from(schema.visitTests).where(eq(schema.visitTests.visitId, visit.id));
  if (vts.length === 0) throw new Error("Visit has no tests.");

  const testRows = await db
    .select()
    .from(schema.tests)
    .where(inArray(schema.tests.id, [...new Set(vts.map((v) => v.testId))]));
  const testById = new Map(testRows.map((t) => [t.id, t]));

  const depts = await db.select().from(schema.departments).where(eq(schema.departments.labId, labId));
  const deptById = new Map(depts.map((d) => [d.id, d]));
  const billingOnly = new Set(depts.filter((d) => d.billingOnly).map((d) => d.id));
  // Same predicate as billing-actions.ts.
  const isReportable = (t: { departmentId: string | null }) => !t.departmentId || !billingOnly.has(t.departmentId);

  const stillBillingOnly: string[] = [];
  const reportable: typeof vts = [];
  for (const vt of vts) {
    const t = testById.get(vt.testId);
    if (!t) continue;
    if (isReportable(t)) reportable.push(vt);
    else stillBillingOnly.push(`${t.name} → ${deptById.get(t.departmentId!)?.name ?? "?"}`);
  }

  console.log("\n  tests on this visit:");
  for (const vt of vts) {
    const t = testById.get(vt.testId);
    const dept = t?.departmentId ? deptById.get(t.departmentId) : null;
    const mark = t && isReportable(t) ? "reportable" : "BILLING-ONLY";
    console.log(`    ${vt.testName.padEnd(40)} ${String(dept?.name ?? "—").padEnd(20)} ${mark}`);
  }

  if (reportable.length === 0) {
    throw new Error(
      "Every test on this visit is still in a billing-only department. " +
        "Re-file them under a reportable department first, then run this again.",
    );
  }
  if (stillBillingOnly.length) {
    console.log(`\n  note: ${stillBillingOnly.length} test(s) stay billing-only and are left alone:`);
    for (const s of stillBillingOnly) console.log(`    ${s}`);
  }

  // ── One sample per distinct sample type, exactly as registration does ────
  const sampleTypeRows = await db.select().from(schema.sampleTypes).where(eq(schema.sampleTypes.labId, labId));
  const sampleTypeById = new Map(sampleTypeRows.map((s) => [s.id, s]));
  const settings = (await db.select().from(schema.labSettings).where(eq(schema.labSettings.labId, labId))).at(0);
  const samplePrefix = settings?.samplePrefix || "S";

  const distinctTypeIds = [
    ...new Set(reportable.map((vt) => testById.get(vt.testId)?.sampleTypeId).filter(Boolean)),
  ] as string[];

  const sampleIdByType = new Map<string, string>();
  const plannedCodes: string[] = [];

  for (const stId of distinctTypeIds) {
    const st = sampleTypeById.get(stId);
    let code = `${samplePrefix}-(next)`;
    const sid = id();

    if (!DRY) {
      // Mirrors nextCode(labId, "sample") — increment the shared counter so the
      // new sample can never collide with one issued by the app.
      const rows = await db
        .update(schema.counters)
        .set({ value: sql`${schema.counters.value} + 1` })
        .where(
          and(
            eq(schema.counters.labId, labId),
            eq(schema.counters.entity, "sample"),
            eq(schema.counters.period, "all"),
          ),
        )
        .returning({ value: schema.counters.value });
      code = formatCode(samplePrefix, rows[0]?.value ?? 1);

      await db.insert(schema.samples).values({
        id: sid,
        labId,
        code,
        visitId: visit.id,
        sampleTypeId: stId,
        sampleTypeName: st?.name ?? "Sample",
        status: "waiting",
        // Credit the person who registered the visit, as registration would have.
        createdBy: visit.createdBy,
      });
    }
    sampleIdByType.set(stId, sid);
    plannedCodes.push(`${code} (${st?.name ?? "Sample"})`);
  }

  // ── Result-entry stubs for the reportable tests ──────────────────────────
  const entryRows = reportable.map((vt) => {
    const t = testById.get(vt.testId)!;
    return {
      id: id(),
      labId,
      visitId: visit.id,
      visitTestId: vt.id,
      testId: vt.testId,
      testName: vt.testName,
      sampleId: t.sampleTypeId ? sampleIdByType.get(t.sampleTypeId) ?? null : null,
      status: "pending" as const,
    };
  });
  if (!DRY && entryRows.length) await db.insert(schema.resultEntries).values(entryRows);

  // ── Refresh the stale department snapshot on visit_tests ─────────────────
  // Written at registration time, so it still records the old (billing-only)
  // department. Nothing reads it today — every lookup goes through
  // tests.department_id — but leaving knowingly-wrong data behind is worse.
  let snapshotFixes = 0;
  for (const vt of vts) {
    const t = testById.get(vt.testId);
    if (!t || vt.departmentId === t.departmentId) continue;
    snapshotFixes++;
    if (!DRY) {
      await db
        .update(schema.visitTests)
        .set({ departmentId: t.departmentId, sampleTypeId: t.sampleTypeId })
        .where(eq(schema.visitTests.id, vt.id));
    }
  }

  // ── Visit status + report link ───────────────────────────────────────────
  if (!DRY) {
    await db.update(schema.visits).set({ status: "sample_pending" }).where(eq(schema.visits.id, visit.id));
  }

  const link = (await db.select().from(schema.reportLinks).where(eq(schema.reportLinks.visitId, visit.id))).at(0);
  if (!link && !DRY) {
    // Mirrors ensureReportLink(): inactive until a result is approved.
    await db.insert(schema.reportLinks).values({
      id: id(),
      labId,
      visitId: visit.id,
      token: publicToken(),
      isActive: false,
    });
  }

  console.log(`\n  samples created      : ${plannedCodes.join(", ")}`);
  console.log(`  result entries       : ${entryRows.length} (status "pending")`);
  console.log(`  department snapshots : ${snapshotFixes} refreshed on visit_tests`);
  console.log(`  report link          : ${link ? "already present" : "created (inactive)"}`);
  console.log(`  visit status         : ${visit.status} -> sample_pending`);
  console.log(`  bill / payments      : untouched`);
  console.log(DRY ? "\nDry run — nothing was written." : `\n${VISIT_CODE} is now in the sample collection queue.`);

  client.close();
}

main().catch((err) => {
  console.error("Repair failed:", err.message ?? err);
  process.exit(1);
});
