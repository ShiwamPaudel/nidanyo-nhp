"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { resultEntries, resultApprovals, visitTests, visits, bills, reportLinks, reportSignatories } from "@/db/schema";
import { authorize } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ActionResult, ok, fail, run } from "@/lib/action";
import { audit, activity } from "@/lib/audit";
import { activateReportLinkIfReady } from "@/lib/report-engine";
import { MAX_REPORT_SIGNATORIES } from "@/lib/report-signatories";

/**
 * Approve all submitted results for a visit under the signatures the approver
 * picked.
 *
 * The chosen `report_signatories` are stored on the VISIT, because a report
 * carries one signature row no matter how many approval rounds produced it. A
 * visit approved in batches (a culture landing days after the CBC) therefore
 * prints whatever the most recent approver selected, and the patient's live
 * link shows the same — the report and the online copy can never disagree.
 * Each round is still recorded individually in `result_approvals.signatoryIds`.
 */
export async function approveVisit(input: {
  visitId: string;
  interpretation?: string | null;
  signatoryIds: string[];
}): Promise<ActionResult<{ released: boolean }>> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.APPROVAL_ACT);
    const visit = (await db.select().from(visits).where(and(eq(visits.id, input.visitId), eq(visits.labId, user.labId)))).at(0);
    if (!visit) return fail("Visit not found.");

    // Selection is mandatory: an unsigned report must not be reachable, even by
    // a caller that skips the UI.
    const wanted = [...new Set((input.signatoryIds ?? []).filter(Boolean))];
    if (wanted.length === 0) return fail("Select at least one signature before approving.");
    if (wanted.length > MAX_REPORT_SIGNATORIES) {
      return fail(`A report can carry at most ${MAX_REPORT_SIGNATORIES} signatures.`);
    }
    const valid = await db
      .select({ id: reportSignatories.id })
      .from(reportSignatories)
      .where(
        and(
          eq(reportSignatories.labId, user.labId),
          eq(reportSignatories.isActive, true),
          inArray(reportSignatories.id, wanted),
        ),
      );
    if (valid.length !== wanted.length) {
      return fail("One of the chosen signatures is no longer available. Reload and pick again.");
    }
    // Keep the order the approver picked — it is the print order, left to right.
    const signatoryIds = wanted;

    const submitted = await db
      .select()
      .from(resultEntries)
      .where(and(eq(resultEntries.visitId, input.visitId), eq(resultEntries.status, "submitted")));
    if (submitted.length === 0) return fail("There are no results awaiting approval.");

    const now = new Date();
    for (const e of submitted) {
      await db
        .update(resultEntries)
        .set({
          status: "approved",
          approvedBy: user.id,
          approvedByName: user.name,
          approvedByDesignation: user.designation ?? null,
          approvedAt: now,
          interpretation: input.interpretation ?? e.interpretation ?? null,
          correctionNote: null,
        })
        .where(eq(resultEntries.id, e.id));
      await db.update(visitTests).set({ status: "approved" }).where(eq(visitTests.id, e.visitTestId));
      await db.insert(resultApprovals).values({
        resultEntryId: e.id,
        action: "approved",
        interpretation: input.interpretation ?? null,
        actorId: user.id,
        actorName: user.name,
        actorDesignation: user.designation ?? null,
        signatoryIds,
      });
    }

    // The report's signature row — latest approval wins (see the note above).
    await db.update(visits).set({ reportSignatoryIds: signatoryIds }).where(eq(visits.id, input.visitId));

    // If every result entry on the visit is now approved, mark the visit approved.
    const remaining = await db
      .select({ id: resultEntries.id })
      .from(resultEntries)
      .where(and(eq(resultEntries.visitId, input.visitId), inArray(resultEntries.status, ["pending", "draft", "submitted", "correction_required"] as never)));

    if (remaining.length === 0) {
      await db.update(visits).set({ status: "approved" }).where(eq(visits.id, input.visitId));
    }
    // Try the release on EVERY approval, not just the last one: with the bill
    // cleared, the tests approved now go live on the patient's QR link straight
    // away, and the link picks up the slower tests as they follow. The SMS is
    // still only sent when the last test is approved (see report-engine).
    const released = await activateReportLinkIfReady(input.visitId);

    await audit(user, "result.approve", { entity: "visit", entityId: input.visitId, summary: `Approved results for ${visit.code}` });
    await activity(user, "result_approved", `Approved results for ${visit.code}`, { entity: "visit", entityId: input.visitId });

    revalidatePath("/approval");
    revalidatePath("/reports");
    revalidatePath("/dispatch");

    const bill = (await db.select().from(bills).where(eq(bills.visitId, input.visitId))).at(0);
    const message = released
      ? remaining.length === 0
        ? "Approved — report released and SMS sent"
        : `Approved — these tests are live on the patient's report link (${remaining.length} still pending)`
      : bill && bill.dueAmount > 0
        ? "Approved — report will release once payment is cleared"
        : "Results approved";
    return ok({ released }, message);
  });
}

/**
 * Reopen already-APPROVED (or dispatched) results — admin only.
 *
 * Approved results are normally locked. When a mistake is found after approval,
 * an admin can send the selected tests back to results entry: they return to
 * `correction_required` with the reason as a correction note, the visit is
 * pulled back to `result_pending`, and the report link is deactivated so the
 * invalid report can't be handed out until the tests are corrected and
 * re-approved (which reactivates the link via the normal approval flow).
 *
 * Gated on SETTINGS_MANAGE — the "admin" capability (lab_admin / super_admin);
 * technicians, reception, pathologists and dispatch cannot do this.
 */
export async function reopenApprovedResults(input: { visitId: string; entryIds: string[]; reason: string }): Promise<ActionResult<{ reopened: number }>> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    if (!input.reason || input.reason.trim().length < 3) return fail("Please provide a reason.");
    if (!input.entryIds?.length) return fail("Select at least one test to reopen.");
    const visit = (await db.select().from(visits).where(and(eq(visits.id, input.visitId), eq(visits.labId, user.labId)))).at(0);
    if (!visit) return fail("Visit not found.");

    const target = await db
      .select()
      .from(resultEntries)
      .where(
        and(
          eq(resultEntries.visitId, input.visitId),
          inArray(resultEntries.id, input.entryIds),
          inArray(resultEntries.status, ["approved", "dispatched"] as never),
        ),
      );
    if (target.length === 0) return fail("No approved results found to reopen.");

    const reason = input.reason.trim();
    for (const e of target) {
      await db.update(resultEntries).set({ status: "correction_required", correctionNote: reason }).where(eq(resultEntries.id, e.id));
      await db.update(visitTests).set({ status: "correction_required" }).where(eq(visitTests.id, e.visitTestId));
      // Logged as a send-back (the existing approval-log action) — reopening an
      // approved result is a send-back that skipped the submitted state.
      await db.insert(resultApprovals).values({ resultEntryId: e.id, action: "sent_back", reason: `Reopened after approval: ${reason}`, actorId: user.id, actorName: user.name });
    }

    // The report is no longer valid — pull the visit back and deactivate its link.
    // `activatedAt` is cleared too: it is the "report-ready message already sent"
    // marker, so clearing it means the patient is notified again once the
    // corrected results are re-approved (the behaviour before partial release).
    await db.update(visits).set({ status: "result_pending" }).where(eq(visits.id, input.visitId));
    await db.update(reportLinks).set({ isActive: false, activatedAt: null }).where(eq(reportLinks.visitId, input.visitId));

    await audit(user, "result.reopen_approved", { entity: "visit", entityId: input.visitId, summary: `Reopened ${target.length} approved result${target.length === 1 ? "" : "s"} for ${visit.code}: ${reason}` });
    await activity(user, "result_reopened", `Reopened approved results for ${visit.code}`, { entity: "visit", entityId: input.visitId });

    revalidatePath("/results");
    revalidatePath("/approval");
    revalidatePath("/reports");
    revalidatePath("/dispatch");
    revalidatePath(`/visits/${input.visitId}`);
    return ok({ reopened: target.length }, `Reopened ${target.length} result${target.length === 1 ? "" : "s"} for correction`);
  });
}

/** Send selected (or all submitted) results back to the technician for correction. */
export async function sendBackResults(input: { visitId: string; reason: string; entryIds?: string[] }): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.APPROVAL_ACT);
    if (!input.reason || input.reason.trim().length < 3) return fail("Please provide a reason.");
    const visit = (await db.select().from(visits).where(and(eq(visits.id, input.visitId), eq(visits.labId, user.labId)))).at(0);
    if (!visit) return fail("Visit not found.");

    const target = input.entryIds?.length
      ? await db.select().from(resultEntries).where(and(eq(resultEntries.visitId, input.visitId), inArray(resultEntries.id, input.entryIds), eq(resultEntries.status, "submitted")))
      : await db.select().from(resultEntries).where(and(eq(resultEntries.visitId, input.visitId), eq(resultEntries.status, "submitted")));
    if (target.length === 0) return fail("There are no submitted results to send back.");

    for (const e of target) {
      await db.update(resultEntries).set({ status: "correction_required", correctionNote: input.reason }).where(eq(resultEntries.id, e.id));
      await db.update(visitTests).set({ status: "correction_required" }).where(eq(visitTests.id, e.visitTestId));
      await db.insert(resultApprovals).values({ resultEntryId: e.id, action: "sent_back", reason: input.reason, actorId: user.id, actorName: user.name });
    }
    await db.update(visits).set({ status: "result_pending" }).where(eq(visits.id, input.visitId));

    await audit(user, "result.send_back", { entity: "visit", entityId: input.visitId, summary: `Sent ${visit.code} back for correction: ${input.reason}` });
    await activity(user, "result_sent_back", `Sent ${visit.code} back for correction`, { entity: "visit", entityId: input.visitId });

    revalidatePath("/approval");
    revalidatePath("/results");
    return ok(undefined, "Sent back for correction");
  });
}
