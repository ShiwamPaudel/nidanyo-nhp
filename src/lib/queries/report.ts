import "server-only";
import { db } from "@/db/client";
import {
  visits,
  patients,
  resultEntries,
  resultValues,
  reportLinks,
  reportDispatches,
  bills,
  reportSignatories,
  departments,
  tests,
  visitTests,
  testGroupItems,
} from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getLab, getLabAsset } from "@/lib/queries/lab";
import { compareEntries, type OrderableEntry } from "@/lib/report-order";
import { pickReportSignatoriesForVisit } from "@/lib/report-signatories";

/**
 * Full data needed to render a final report (approved results only — a visit
 * whose other tests are still in progress simply reports the approved ones).
 *
 * `entryIds`, when given, restricts the report to that subset of approved
 * entries — used to print just one or two completed tests from a visit whose
 * other tests may still be in progress. Omitted → every approved entry.
 */
export async function getReportData(labId: string, visitId: string, onlyEntryIds?: string[]) {
  const visit = (await db.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.labId, labId)))).at(0);
  if (!visit) return null;
  const patient = (await db.select().from(patients).where(eq(patients.id, visit.patientId))).at(0);
  const bill = (await db.select().from(bills).where(eq(bills.visitId, visitId))).at(0);

  // "dispatched" is an approved entry that has since been handed over (the
  // dispatch action flips the status), so it still belongs on the report —
  // otherwise a reprint, and the patient's QR link, would come back empty once
  // the lab records the handover.
  const entryConds = [eq(resultEntries.visitId, visitId), inArray(resultEntries.status, ["approved", "dispatched"] as never)];
  if (onlyEntryIds && onlyEntryIds.length > 0) entryConds.push(inArray(resultEntries.id, onlyEntryIds));
  const entries = await db
    .select()
    .from(resultEntries)
    .where(and(...entryConds))
    .orderBy(asc(resultEntries.testName));

  const entryIds = entries.map((e) => e.id);
  const values = entryIds.length
    ? await db.select().from(resultValues).where(inArray(resultValues.resultEntryId, entryIds)).orderBy(asc(resultValues.displayOrder))
    : [];
  const valuesByEntry = new Map<string, typeof values>();
  for (const v of values) {
    const arr = valuesByEntry.get(v.resultEntryId) ?? [];
    arr.push(v);
    valuesByEntry.set(v.resultEntryId, arr);
  }

  // Department names for grouping
  const testIds = [...new Set(entries.map((e) => e.testId))];
  const testRows = testIds.length ? await db.select().from(tests).where(inArray(tests.id, testIds)) : [];
  const deptRows = await db.select().from(departments).where(eq(departments.labId, labId));
  const deptRowById = new Map(deptRows.map((d) => [d.id, d]));
  const deptById = new Map(deptRows.map((d) => [d.id, d.name]));
  const testById = new Map(testRows.map((t) => [t.id, t]));
  const deptByTest = new Map(testRows.map((t) => [t.id, t.departmentId ? deptById.get(t.departmentId) ?? null : null]));
  const noteByTest = new Map(testRows.map((t) => [t.id, t.description ?? null]));
  const methodByTest = new Map(testRows.map((t) => [t.id, t.method ?? null]));

  // Group tag snapshotted on the visit test + the order configured inside that
  // group, so a profile like CBC prints in its clinical order rather than
  // alphabetically.
  const vtRows = await db.select().from(visitTests).where(eq(visitTests.visitId, visitId));
  const vtById = new Map(vtRows.map((v) => [v.id, v]));
  const groupIds = [...new Set(vtRows.map((v) => v.groupId).filter(Boolean))] as string[];
  const itemOrder = new Map<string, number>(); // `${groupId}|${testId}` -> displayOrder
  if (groupIds.length) {
    const items = await db.select().from(testGroupItems).where(inArray(testGroupItems.groupId, groupIds));
    for (const it of items) itemOrder.set(`${it.groupId}|${it.testId}`, it.displayOrder);
  }

  const orderKey = (e: (typeof entries)[number]): OrderableEntry => {
    const t = testById.get(e.testId);
    const dept = t?.departmentId ? deptRowById.get(t.departmentId) ?? null : null;
    const vt = vtById.get(e.visitTestId);
    return {
      testId: e.testId,
      testName: e.testName,
      departmentName: dept?.name ?? null,
      departmentOrder: dept?.displayOrder ?? null,
      groupName: vt?.groupName ?? null,
      groupItemOrder: vt?.groupId ? itemOrder.get(`${vt.groupId}|${e.testId}`) ?? null : null,
      testOrder: t?.displayOrder ?? null,
    };
  };
  entries.sort((a, b) => compareEntries(orderKey(a), orderKey(b)));

  // Report signatories — the blocks the approver selected when signing this
  // visit, in the order they picked them. See `pickReportSignatoriesForVisit`.
  const signatoryRows = await db
    .select()
    .from(reportSignatories)
    .where(and(eq(reportSignatories.labId, labId), eq(reportSignatories.isActive, true)))
    .orderBy(asc(reportSignatories.displayOrder), asc(reportSignatories.createdAt));
  const signatories = pickReportSignatoriesForVisit(signatoryRows, visit);

  const { lab, settings } = await getLab(labId);
  const [headerAsset, footerAsset] = await Promise.all([
    getLabAsset(labId, "report_header"),
    getLabAsset(labId, "report_footer"),
  ]);
  const link = (await db.select().from(reportLinks).where(eq(reportLinks.visitId, visitId))).at(0);
  const dispatches = await db.select().from(reportDispatches).where(eq(reportDispatches.visitId, visitId));

  return {
    visit,
    patient,
    bill,
    lab,
    settings,
    headerUrl: headerAsset?.url ?? null,
    footerUrl: footerAsset?.url ?? null,
    signatories,
    link,
    dispatches,
    entries: entries.map((e) => ({
      entry: e,
      values: valuesByEntry.get(e.id) ?? [],
      department: deptByTest.get(e.testId) ?? null,
      note: noteByTest.get(e.testId) ?? null,
      method: methodByTest.get(e.testId) ?? null,
      // Profile/panel this test was ordered under (snapshot on the visit test),
      // so the report can print "Complete Blood Count (CBC)" above its tests.
      groupName: vtById.get(e.visitTestId)?.groupName ?? null,
    })),
  };
}

export interface ReportTestOption {
  entryId: string;
  testName: string;
  department: string | null;
  status: string;
  /** Profile/panel the test was ordered under, if any (snapshot on the visit test). */
  groupId: string | null;
  groupName: string | null;
}

/**
 * Every result entry (test) on a visit with its current status — powers the
 * "print selected tests" picker. Unlike getReportData this is not limited to
 * approved entries: draft / pending tests are returned too so the UI can show
 * them (disabled) with their status, while only approved ones are printable.
 * Ordered by department then test name, mirroring the report.
 */
export async function listReportTestOptions(labId: string, visitId: string): Promise<ReportTestOption[]> {
  const visit = (await db.select({ id: visits.id }).from(visits).where(and(eq(visits.id, visitId), eq(visits.labId, labId)))).at(0);
  if (!visit) return [];

  const rows = await db.select().from(resultEntries).where(eq(resultEntries.visitId, visitId));
  if (rows.length === 0) return [];

  const testIds = [...new Set(rows.map((e) => e.testId))];
  const testRows = testIds.length ? await db.select().from(tests).where(inArray(tests.id, testIds)) : [];
  const testById = new Map(testRows.map((t) => [t.id, t]));
  const deptRows = await db.select().from(departments).where(eq(departments.labId, labId));
  const deptById = new Map(deptRows.map((d) => [d.id, d]));
  // Profile tag snapshotted on the visit test — lets the picker offer a whole
  // panel (CBC…) as one item instead of its member tests one by one.
  const vtRows = await db.select().from(visitTests).where(eq(visitTests.visitId, visitId));
  const vtById = new Map(vtRows.map((v) => [v.id, v]));

  return rows
    .map((e) => {
      const t = testById.get(e.testId);
      const dept = t?.departmentId ? deptById.get(t.departmentId) ?? null : null;
      const vt = vtById.get(e.visitTestId);
      return {
        entryId: e.id,
        testName: e.testName,
        department: dept?.name ?? null,
        deptOrder: dept?.displayOrder ?? 999,
        status: e.status as string,
        groupId: vt?.groupId ?? null,
        groupName: vt?.groupName ?? null,
      };
    })
    // Department, then standalone tests before profiles, then a profile's own
    // tests kept together — the same shape the printed report uses.
    .sort(
      (a, b) =>
        a.deptOrder - b.deptOrder ||
        (a.groupName ?? "").localeCompare(b.groupName ?? "") ||
        a.testName.localeCompare(b.testName),
    )
    .map(({ deptOrder: _deptOrder, ...rest }) => rest);
}
