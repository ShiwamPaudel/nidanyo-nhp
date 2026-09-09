import "server-only";
import { db } from "@/db/client";
import { resultEntries, resultValues, visits, patients, bills, reportSignatories } from "@/db/schema";
import { and, asc, desc, eq, inArray, like, or, sql, ne } from "drizzle-orm";

/** Visits that have submitted results awaiting approval. */
export async function listApprovalQueue(labId: string, opts: { q?: string } = {}) {
  const term = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const conds = [eq(resultEntries.labId, labId), eq(resultEntries.status, "submitted"), ne(visits.status, "cancelled")];
  if (term) conds.push(or(like(visits.code, term), like(patients.fullName, term), like(patients.phone, term))!);

  const rows = await db
    .select({
      visitId: resultEntries.visitId,
      visitCode: visits.code,
      priority: visits.priority,
      patientName: patients.fullName,
      patientCode: patients.code,
      submitted: sql<number>`count(*)`,
      hasCritical: sql<number>`max(${resultEntries.hasCritical})`,
      hasAbnormal: sql<number>`max(${resultEntries.hasAbnormal})`,
      submittedAt: sql<number>`max(${resultEntries.submittedAt})`,
    })
    .from(resultEntries)
    .innerJoin(visits, eq(resultEntries.visitId, visits.id))
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .where(and(...conds))
    .groupBy(resultEntries.visitId)
    .orderBy(desc(sql`max(${resultEntries.submittedAt})`))
    .limit(200);

  return rows.map((r) => ({ ...r, submitted: Number(r.submitted), hasCritical: Number(r.hasCritical) > 0, hasAbnormal: Number(r.hasAbnormal) > 0 }));
}

/** Full review data for a visit (only submitted/approved entries shown). */
export async function getVisitForApproval(labId: string, visitId: string) {
  const visit = (await db.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.labId, labId)))).at(0);
  if (!visit) return null;
  const patient = (await db.select().from(patients).where(eq(patients.id, visit.patientId))).at(0);
  const bill = (await db.select().from(bills).where(eq(bills.visitId, visitId))).at(0);
  const entries = await db
    .select()
    .from(resultEntries)
    .where(and(eq(resultEntries.visitId, visitId), inArray(resultEntries.status, ["submitted", "approved", "correction_required"] as never)))
    .orderBy(asc(resultEntries.testName));
  const entryIds = entries.map((e) => e.id);
  const values = entryIds.length ? await db.select().from(resultValues).where(inArray(resultValues.resultEntryId, entryIds)).orderBy(asc(resultValues.displayOrder)) : [];
  const valuesByEntry = new Map<string, typeof values>();
  for (const v of values) {
    const arr = valuesByEntry.get(v.resultEntryId) ?? [];
    arr.push(v);
    valuesByEntry.set(v.resultEntryId, arr);
  }
  return {
    visit,
    patient,
    bill,
    entries: entries.map((e) => ({ entry: e, values: valuesByEntry.get(e.id) ?? [] })),
  };
}

/**
 * The signature blocks an approver may apply, in configured order. Every active
 * signatory in the lab is offered — the choice is made per approval now, not by
 * who registered the visit.
 */
export async function listSignatoriesForApproval(labId: string) {
  return db
    .select({
      id: reportSignatories.id,
      name: reportSignatories.name,
      description: reportSignatories.description,
      url: reportSignatories.url,
    })
    .from(reportSignatories)
    .where(and(eq(reportSignatories.labId, labId), eq(reportSignatories.isActive, true)))
    .orderBy(asc(reportSignatories.displayOrder), asc(reportSignatories.createdAt));
}
